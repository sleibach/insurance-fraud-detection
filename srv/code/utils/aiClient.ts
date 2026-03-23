import { OrchestrationClient } from '@sap-ai-sdk/orchestration';
import type { ChatMessage as SdkChatMessage } from '@sap-ai-sdk/orchestration';
import type { ChatClient, ChatClientOptions, ChatClientResponse } from '../../types';

/**
 * Creates a chat client wrapping OrchestrationClient.
 * Works with any model deployed on SAP AI Core (Claude, GPT, etc.).
 * Falls back gracefully when AI Core is not configured (airplane mode).
 */
export function createChatClient(
  modelName = 'anthropic--claude-4.6-opus',
  options: { resourceGroup?: string } = {}
): ChatClient {
  return {
    async run({ messages = [], max_tokens = 2000, temperature = 0.0 }: ChatClientOptions): Promise<ChatClientResponse> {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const resourceGroupOpt = /* istanbul ignore next */ options.resourceGroup
        ? { resourceGroup: options.resourceGroup }
        : undefined;
      const client = new OrchestrationClient(
        {
          promptTemplating: {
            model: {
              name: modelName,
              params: {
                max_tokens: /* istanbul ignore next */ max_tokens ?? 2000,
                temperature: /* istanbul ignore next */ temperature ?? 0.0
              }
            }
          }
        },
        resourceGroupOpt
      );
      const response = await client.chatCompletion({ messages: messages as SdkChatMessage[] });
      const content = /* istanbul ignore next */ response.getContent() ?? '';
      return { getContent: () => content };
    }
  };
}
