'use strict';
const { AzureOpenAiChatClient } = require('@sap-ai-sdk/foundation-models');

/**
 * Creates a configured AzureOpenAiChatClient instance.
 * @param {string} modelName - e.g. 'gpt-4o', 'gpt-4o-mini'
 * @param {{ resourceGroup?: string, deploymentId?: string }} [options]
 * @returns {AzureOpenAiChatClient}
 */
function createChatClient(modelName = 'gpt-4o', options = {}) {
  if (options.deploymentId) {
    return new AzureOpenAiChatClient({ deploymentId: options.deploymentId });
  }
  if (options.resourceGroup) {
    return new AzureOpenAiChatClient({ modelName, resourceGroup: options.resourceGroup });
  }
  return new AzureOpenAiChatClient(modelName);
}

module.exports = { createChatClient };
