'use strict';
const { OrchestrationClient } = require('@sap-ai-sdk/orchestration');

/**
 * Creates a chat client wrapping OrchestrationClient.
 * Works with any model deployed on SAP AI Core (Claude, GPT, etc.).
 * Falls back gracefully when AI Core is not configured (airplane mode).
 *
 * @param {string} modelName - Model name (e.g. 'anthropic--claude-4.6-opus')
 * @param {{ resourceGroup?: string }} [options]
 * @returns {{ run(opts): Promise<{ getContent(): string }> }}
 */
function createChatClient(modelName = 'anthropic--claude-4.6-opus', options = {}) {
  return {
    async run({ messages = [], max_tokens = 2000, temperature = 0.0 }) {
      const client = new OrchestrationClient(
        {
          promptTemplating: {
            model: {
              name: modelName,
              params: { max_tokens, temperature }
            }
          }
        },
        options.resourceGroup ? { resourceGroup: options.resourceGroup } : undefined
      );
      const response = await client.chatCompletion({ messages });
      return { getContent: () => response.getContent() };
    }
  };
}

module.exports = { createChatClient };
