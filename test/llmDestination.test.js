'use strict';

// Unit tests for the switchable third-party (OpenRouter via BTP destination)
// source for the open-source evaluator models.
const mockGetDestination = jest.fn();
jest.mock('@sap-cloud-sdk/connectivity', () => ({
  getDestination: (...a) => mockGetDestination(...a)
}));

const { resolveDestinationEndpoint, mapModelId } = require('../srv/code/utils/llmDestination');

const ENV_KEYS = [
  'OSS_LLM_DESTINATION',
  'OSS_GPT_OSS_120B_PROVIDER_ID',
  'OSS_GEMMA_3_27B_PROVIDER_ID'
];

beforeEach(() => mockGetDestination.mockReset());
afterEach(() => ENV_KEYS.forEach(k => delete process.env[k]));

describe('mapModelId', () => {
  test('maps the three open-source models to their OpenRouter ids', () => {
    expect(mapModelId('gpt-oss-120b')).toBe('openai/gpt-oss-120b');
    expect(mapModelId('gpt-oss-20b')).toBe('openai/gpt-oss-20b');
    expect(mapModelId('gemma-3-27b')).toBe('google/gemma-3-27b-it');
  });

  test('falls back to the internal name for unknown models', () => {
    expect(mapModelId('mystery-model')).toBe('mystery-model');
  });

  test('honours a per-model env override', () => {
    process.env.OSS_GPT_OSS_120B_PROVIDER_ID = 'vendor/custom-120b';
    expect(mapModelId('gpt-oss-120b')).toBe('vendor/custom-120b');
  });
});

describe('resolveDestinationEndpoint', () => {
  test('returns baseUrl, forwarded headers and mapped model id', async () => {
    mockGetDestination.mockResolvedValue({
      url: 'https://openrouter.ai/api/v1',
      originalProperties: {
        Name: 'openrouter-llm',
        'URL.headers.Authorization': 'Bearer sk-or-xyz',
        'URL.headers.Content-Type': 'application/json'
      }
    });

    const ep = await resolveDestinationEndpoint('gpt-oss-120b');
    expect(ep).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      headers: { Authorization: 'Bearer sk-or-xyz', 'Content-Type': 'application/json' },
      modelId: 'openai/gpt-oss-120b'
    });
    expect(mockGetDestination).toHaveBeenCalledWith({ destinationName: 'openrouter-llm' });
  });

  test('uses OSS_LLM_DESTINATION to pick the destination name', async () => {
    process.env.OSS_LLM_DESTINATION = 'my-router';
    mockGetDestination.mockResolvedValue({ url: 'https://x/v1', originalProperties: {} });
    await resolveDestinationEndpoint('gemma-3-27b');
    expect(mockGetDestination).toHaveBeenCalledWith({ destinationName: 'my-router' });
  });

  test('derives Authorization from authTokens when no forwarded header is set', async () => {
    mockGetDestination.mockResolvedValue({
      url: 'https://x/v1',
      authTokens: [{ value: 'tok-123' }]
    });
    const ep = await resolveDestinationEndpoint('gpt-oss-20b');
    expect(ep.headers).toEqual({ Authorization: 'Bearer tok-123' });
  });

  test('merges resolved destination headers', async () => {
    mockGetDestination.mockResolvedValue({
      url: 'https://x/v1',
      headers: { 'X-Custom': 'v' }
    });
    const ep = await resolveDestinationEndpoint('gemma-3-27b');
    expect(ep.headers['X-Custom']).toBe('v');
  });

  test('returns null when the destination has no URL', async () => {
    mockGetDestination.mockResolvedValue({ originalProperties: {} });
    expect(await resolveDestinationEndpoint('gpt-oss-120b')).toBeNull();
  });

  test('returns null when destination resolution throws (airplane-mode fallback)', async () => {
    mockGetDestination.mockRejectedValue(new Error('no binding'));
    expect(await resolveDestinationEndpoint('gpt-oss-120b')).toBeNull();
  });
});
