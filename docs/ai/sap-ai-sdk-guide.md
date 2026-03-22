# SAP AI SDK Guide

Authoritative guide for using SAP AI SDK foundation models in this project. All LLM/AI calls go through SAP AI Core via `@sap-ai-sdk/foundation-models`.

## Setup

### Installation

```bash
npm install @sap-ai-sdk/foundation-models
```

### AI Core Binding in package.json

```json
{
  "cds": {
    "requires": {
      "aicore": {
        "kind": "aicore",
        "credentials": {
          "destination": "aicore"
        }
      }
    }
  }
}
```

For local development, bind via `cds bind` or `.cdsrc-private.json`.

## Client Initialization

```javascript
const { AzureOpenAiChatClient } = require('@sap-ai-sdk/foundation-models');

// Simple -- uses 'default' resource group, 'latest' model version
const client = new AzureOpenAiChatClient('gpt-4o');

// With resource group
const client = new AzureOpenAiChatClient({
  modelName: 'gpt-4o',
  resourceGroup: 'my-resource-group'
});

// With specific deployment
const client = new AzureOpenAiChatClient({
  deploymentId: 'd1234'
});
```

## Chat Completion

### Basic Request

```javascript
const response = await client.run({
  messages: [
    { role: 'system', content: 'You are an insurance claim analyst.' },
    { role: 'user', content: 'Analyze this claim data...' }
  ],
  max_tokens: 2000,
  temperature: 0.0
});

const content = response.getContent();
const tokenUsage = response.getTokenUsage();
```

### Structured Output (JSON Schema)

Use `response_format` with `json_schema` for predictable structured responses. This is critical for the Structure Agent and Evaluation Agent.

```javascript
const response = await client.run({
  messages: [
    { role: 'system', content: 'Extract structured data from the claim.' },
    { role: 'user', content: claimDescription }
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'structured_claim',
      description: 'Structured claim data extracted from documents',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          claimType: { type: 'string', description: 'Type of insurance claim' },
          incidentDate: { type: 'string', description: 'Date of incident (ISO 8601)' },
          claimAmount: { type: 'number', description: 'Claimed amount in EUR' },
          description: { type: 'string', description: 'Description of the incident' }
        },
        required: ['claimType', 'incidentDate', 'claimAmount', 'description'],
        additionalProperties: false
      }
    }
  }
});

const structuredData = JSON.parse(response.getContent());
```

### Vision (Image/Document Analysis)

For the Structure Agent -- analyzing claim attachments (photos, PDFs rendered as images):

```javascript
const response = await client.run({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this claim document and extract key information.' },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64Image}`
          }
        }
      ]
    }
  ],
  max_tokens: 4000
});
```

## Embedding Client

For potential similarity search or claim clustering:

```javascript
const { AzureOpenAiEmbeddingClient } = require('@sap-ai-sdk/foundation-models');

const embeddingClient = new AzureOpenAiEmbeddingClient('text-embedding-3-small');

const response = await embeddingClient.run({
  input: ['Insurance claim for water damage in basement']
});

const embedding = response.getEmbedding();
```

## Streaming

For long-running responses (e.g., evaluation explanations):

```javascript
const response = await client.stream({
  messages: [
    { role: 'user', content: 'Provide a detailed evaluation of this claim...' }
  ]
});

for await (const chunk of response.stream.toContentStream()) {
  process.stdout.write(chunk);
}

const finishReason = response.getFinishReason();
const tokenUsage = response.getTokenUsage();
```

## Resilience

Always add resilience for production:

```javascript
const { resilience } = require('@sap-cloud-sdk/resilience');

const response = await client.run(request, {
  middleware: resilience({
    timeout: 30000,
    circuitBreaker: true,
    retry: 3
  })
});
```

## Error Handling Pattern

Wrap AI calls in try/catch and use CAP error mechanisms:

```javascript
const { AzureOpenAiChatClient } = require('@sap-ai-sdk/foundation-models');

module.exports = async function (req) {
  const client = new AzureOpenAiChatClient('gpt-4o');

  try {
    const response = await client.run({
      messages: [{ role: 'user', content: req.data.prompt }],
      max_tokens: 2000
    });
    return response.getContent();
  } catch (error) {
    if (error.response?.status === 429) {
      req.reject(429, 'AI service rate limit exceeded. Please retry later.');
    }
    req.reject(500, `AI service error: ${error.message}`);
  }
};
```

## Rules

- **Always** use `@sap-ai-sdk/foundation-models` -- never use the generic OpenAI SDK directly
- **Always** use structured output (`response_format` with `json_schema`) when you need predictable data extraction
- **Always** add resilience middleware for production deployments
- **Prefer** low temperature (0.0-0.2) for data extraction tasks, higher (0.5-0.7) for creative evaluation text
- **Log** token usage for cost monitoring
- AI logic lives in `srv/code/` like all other implementation code
