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

const { createChatClient } = require('../srv/code/utils/aiClient');

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
});
