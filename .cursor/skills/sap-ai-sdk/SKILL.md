---
name: sap-ai-sdk
description: >-
  SAP AI SDK foundation models integration guide. Use when working with LLM
  integration, AI agents, chat completion, vision, structured output,
  embeddings, SAP AI Core, or the AzureOpenAiChatClient.
---

# SAP AI SDK Integration

## Standards

Read `docs/ai/sap-ai-sdk-guide.md` for all AI SDK patterns including:
- Client initialization (`AzureOpenAiChatClient`, `AzureOpenAiEmbeddingClient`)
- Chat completion with message history
- Structured output via `response_format` with `json_schema`
- Vision (image analysis) for document processing
- Streaming responses
- Resilience (circuit breaker, timeout, retry)
- Error handling patterns

## Quick Reference

```javascript
const { AzureOpenAiChatClient } = require('@sap-ai-sdk/foundation-models');

const client = new AzureOpenAiChatClient('gpt-4o');

const response = await client.run({
  messages: [
    { role: 'system', content: 'You are an insurance analyst.' },
    { role: 'user', content: prompt }
  ],
  max_tokens: 2000,
  temperature: 0.0
});

const content = response.getContent();
```

## Rules

- Always use `@sap-ai-sdk/foundation-models`, never the generic OpenAI SDK
- AI logic files live in `srv/code/` following the standard naming pattern
- Use structured output (`json_schema`) for data extraction tasks
- Add resilience middleware for production
