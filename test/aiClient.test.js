'use strict';

// Unit test for the thin createChatClient utility.
// Mock OrchestrationClient to verify the wrapper calls it correctly.
const mockChatCompletion = jest.fn();
const MockOrchestrationClient = jest.fn().mockImplementation(() => ({
  chatCompletion: mockChatCompletion
}));

jest.mock('@sap-ai-sdk/orchestration', () => ({
  OrchestrationClient: MockOrchestrationClient
}));

// Mock the destination resolver so the OSS_LLM_SOURCE=destination branch is
// exercised without a real BTP destination service binding.
const mockResolveDestinationEndpoint = jest.fn();
jest.mock('../srv/code/utils/llmDestination', () => ({
  resolveDestinationEndpoint: (...a) => mockResolveDestinationEndpoint(...a)
}));

const {
  createChatClient, createOpenSourceChatClient, resolveOssEndpoint, ossSource, chatCompletionsUrl
} = require('../srv/code/utils/aiClient');

beforeEach(() => {
  MockOrchestrationClient.mockClear();
  mockChatCompletion.mockReset();
  mockChatCompletion.mockResolvedValue({ getContent: () => '{}' });
});

describe('createChatClient', () => {
  test('creates OrchestrationClient with model name and run-time params', async () => {
    const client = createChatClient('anthropic--claude-4.6-opus');
    await client.run({ messages: [{ role: 'user', content: 'test' }], max_tokens: 1000, temperature: 0.5 });
    expect(MockOrchestrationClient).toHaveBeenCalledWith(
      { promptTemplating: { model: { name: 'anthropic--claude-4.6-opus', params: { max_tokens: 1000, temperature: 0.5 } } } },
      undefined
    );
  });

  test('defaults to anthropic--claude-4.6-opus model', async () => {
    const client = createChatClient();
    await client.run({ messages: [] });
    expect(MockOrchestrationClient).toHaveBeenCalledWith(
      expect.objectContaining({ promptTemplating: { model: expect.objectContaining({ name: 'anthropic--claude-4.6-opus' }) } }),
      undefined
    );
  });

  test('passes resourceGroup as deploymentConfig when provided', async () => {
    const client = createChatClient('anthropic--claude-4.6-opus', { resourceGroup: 'my-rg' });
    await client.run({ messages: [] });
    expect(MockOrchestrationClient).toHaveBeenCalledWith(
      expect.any(Object),
      { resourceGroup: 'my-rg' }
    );
  });

  test('run returns getContent from chatCompletion response', async () => {
    mockChatCompletion.mockResolvedValue({ getContent: () => '{"result": true}' });
    const client = createChatClient('anthropic--claude-4.6-opus');
    const response = await client.run({ messages: [] });
    expect(response.getContent()).toBe('{"result": true}');
    expect(mockChatCompletion).toHaveBeenCalledWith({ messages: [] });
  });

  test('surfaces token usage from the SDK (snake_case → camelCase)', async () => {
    mockChatCompletion.mockResolvedValue({
      getContent: () => '{}',
      getTokenUsage: () => ({ prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 })
    });
    const client = createChatClient('anthropic--claude-4.6-opus');
    const response = await client.run({ messages: [] });
    expect(response.getTokenUsage()).toEqual({ promptTokens: 100, completionTokens: 40, totalTokens: 140 });
  });

  test('token usage defaults to zeros when the SDK omits it', async () => {
    mockChatCompletion.mockResolvedValue({ getContent: () => '{}' });
    const client = createChatClient();
    const response = await client.run({ messages: [] });
    expect(response.getTokenUsage()).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

// ─── Open-source (BYOM) chat client ───────────────────────────────────────────

describe('resolveOssEndpoint', () => {
  const ENV_KEYS = ['OSS_TESTMODEL_URL', 'OSS_TESTMODEL_TOKEN', 'OSS_LLM_BASE_URL', 'OSS_LLM_TOKEN', 'OSS_LLM_RESOURCE_GROUP'];
  afterEach(() => ENV_KEYS.forEach(k => delete process.env[k]));

  test('explicit baseUrl wins', async () => {
    const ep = await resolveOssEndpoint('testmodel', { baseUrl: 'http://x', token: 't', resourceGroup: 'rg' });
    expect(ep).toEqual({ baseUrl: 'http://x', token: 't', resourceGroup: 'rg' });
  });

  test('resolves from per-model environment variables', async () => {
    process.env.OSS_TESTMODEL_URL = 'http://oss.example';
    process.env.OSS_TESTMODEL_TOKEN = 'secret';
    const ep = await resolveOssEndpoint('testmodel');
    expect(ep.baseUrl).toBe('http://oss.example');
    expect(ep.token).toBe('secret');
    expect(ep.resourceGroup).toBe('default');
  });

  test('throws OSS_LLM_UNREACHABLE when no endpoint resolves', async () => {
    await expect(resolveOssEndpoint('no-such-model')).rejects.toThrow(/OSS_LLM_UNREACHABLE/);
  });
});

describe('createOpenSourceChatClient', () => {
  afterEach(() => { delete global.fetch; delete process.env.OSS_TESTMODEL_URL; delete process.env.OSS_TESTMODEL_TOKEN; });

  test('calls the OpenAI-compatible endpoint and reads content + usage', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"riskLevel":"low"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      })
    });
    const client = createOpenSourceChatClient('testmodel', { baseUrl: 'http://oss.example/', token: 'abc', resourceGroup: 'rg1' });
    const res = await client.run({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.getContent()).toBe('{"riskLevel":"low"}');
    expect(res.getTokenUsage()).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://oss.example/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer abc');
    expect(init.headers['AI-Resource-Group']).toBe('rg1');
  });

  test('non-OK response throws OSS_LLM_HTTP error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'unavailable' });
    const client = createOpenSourceChatClient('testmodel', { baseUrl: 'http://oss.example' });
    await expect(client.run({ messages: [] })).rejects.toThrow(/OSS_LLM_HTTP_503/);
  });
});

// ─── Source switch (AI Core BYOM ↔ OpenRouter via BTP destination) ────────────

describe('ossSource', () => {
  const KEYS = ['OSS_LLM_SOURCE', 'OSS_TESTMODEL_SOURCE'];
  afterEach(() => KEYS.forEach(k => delete process.env[k]));

  test('defaults to aicore', () => {
    expect(ossSource('testmodel')).toBe('aicore');
  });

  test('global OSS_LLM_SOURCE=destination selects destination', () => {
    process.env.OSS_LLM_SOURCE = 'destination';
    expect(ossSource('testmodel')).toBe('destination');
  });

  test('per-model OSS_<MODEL>_SOURCE overrides the global switch', () => {
    process.env.OSS_LLM_SOURCE = 'aicore';
    process.env.OSS_TESTMODEL_SOURCE = 'destination';
    expect(ossSource('testmodel')).toBe('destination');
  });
});

describe('chatCompletionsUrl', () => {
  test('appends /v1/chat/completions to a bare base', () => {
    expect(chatCompletionsUrl('http://oss.example')).toBe('http://oss.example/v1/chat/completions');
    expect(chatCompletionsUrl('http://oss.example/')).toBe('http://oss.example/v1/chat/completions');
  });

  test('only appends /chat/completions when the base already ends in /v1', () => {
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

describe('resolveOssEndpoint with OSS_LLM_SOURCE=destination', () => {
  afterEach(() => {
    delete process.env.OSS_LLM_SOURCE;
    mockResolveDestinationEndpoint.mockReset();
  });

  test('routes through the destination resolver', async () => {
    process.env.OSS_LLM_SOURCE = 'destination';
    mockResolveDestinationEndpoint.mockResolvedValue({
      baseUrl: 'https://openrouter.ai/api/v1',
      headers: { Authorization: 'Bearer sk-or' },
      modelId: 'openai/gpt-oss-120b'
    });
    const ep = await resolveOssEndpoint('gpt-oss-120b');
    expect(mockResolveDestinationEndpoint).toHaveBeenCalledWith('gpt-oss-120b');
    expect(ep.modelId).toBe('openai/gpt-oss-120b');
  });

  test('throws OSS_LLM_UNREACHABLE when the destination resolver returns null', async () => {
    process.env.OSS_LLM_SOURCE = 'destination';
    mockResolveDestinationEndpoint.mockResolvedValue(null);
    await expect(resolveOssEndpoint('gpt-oss-120b')).rejects.toThrow(/OSS_LLM_UNREACHABLE/);
  });
});

describe('createOpenSourceChatClient against a destination endpoint', () => {
  afterEach(() => { delete global.fetch; });

  test('sends the mapped model id, merges headers, and normalizes the /v1 path', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"riskLevel":"high"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
      })
    });

    const client = createOpenSourceChatClient('gpt-oss-120b', {
      baseUrl: 'https://openrouter.ai/api/v1',
      headers: { Authorization: 'Bearer sk-or' },
      modelId: 'openai/gpt-oss-120b'
    });
    const res = await client.run({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.getContent()).toBe('{"riskLevel":"high"}');
    expect(res.getTokenUsage()).toEqual({ promptTokens: 12, completionTokens: 8, totalTokens: 20 });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer sk-or');
    expect(init.headers['AI-Resource-Group']).toBeUndefined();
    expect(JSON.parse(init.body).model).toBe('openai/gpt-oss-120b');
  });
});
