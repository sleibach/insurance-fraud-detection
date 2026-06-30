import { OrchestrationClient } from '@sap-ai-sdk/orchestration';
import type { ChatMessage as SdkChatMessage } from '@sap-ai-sdk/orchestration';
import type { ChatClient, ChatClientOptions, ChatClientResponse, TokenUsage } from '../../types';

/** Normalize the SDK's snake_case token usage into our camelCase TokenUsage. */
function readTokenUsage(response: unknown): TokenUsage {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const r = response as any;
  /* istanbul ignore next -- getTokenUsage may be absent on stubbed responses */
  const u = (typeof r?.getTokenUsage === 'function' ? r.getTokenUsage() : undefined) ?? {};
  return {
    promptTokens:     u.prompt_tokens     ?? u.promptTokens     ?? 0,
    completionTokens: u.completion_tokens  ?? u.completionTokens ?? 0,
    totalTokens:      u.total_tokens       ?? u.totalTokens      ?? 0
  };
}

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
      const tokenUsage = readTokenUsage(response);
      return { getContent: () => content, getTokenUsage: () => tokenUsage };
    }
  };
}

// ─── Open-source LLM (BYOM) chat client ───────────────────────────────────────
//
// Self-hosted open-source models (gpt-oss-120b/20b, gemma-3-27b) run as custom
// vLLM deployments on SAP AI Core and expose an OpenAI-compatible API. We call
// them directly (not via OrchestrationClient) at `<deploymentUrl>/v1/chat/completions`.
//
// Endpoint resolution order:
//   1. explicit options.baseUrl
//   2. env OSS_<MODEL>_URL / OSS_LLM_BASE_URL (+ matching *_TOKEN)
//   3. source switch OSS_LLM_SOURCE (per-model OSS_<MODEL>_SOURCE):
//        'destination' → OpenRouter via BTP destination (utils/llmDestination)
//        'aicore' (default) → AI Core deployment lookup (utils/aicoreDeployment)
// When no endpoint can be resolved a connectivity-style error is thrown so the
// caller falls back to a stub evaluation (airplane mode).

const OSS_TIMEOUT_MS = Number(process.env.OSS_LLM_TIMEOUT_MS || 60000);

export interface OssEndpoint {
  baseUrl: string;
  token?: string;
  resourceGroup?: string;
  /** Extra headers to send (e.g. Authorization forwarded by a BTP destination). */
  headers?: Record<string, string>;
  /** Provider-specific model id to send in the request body (e.g. OpenRouter's
   *  `openai/gpt-oss-120b`). Falls back to the internal model name when unset. */
  modelId?: string;
}

function envKey(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Which backend serves the open-source evaluator models:
 *   'destination' → a hosted provider (OpenRouter) via a shared BTP destination
 *   'aicore'      → self-hosted vLLM deployments on SAP AI Core (BYOM, default)
 * Global switch OSS_LLM_SOURCE, overridable per model via OSS_<MODEL>_SOURCE.
 */
export function ossSource(modelName?: string): 'destination' | 'aicore' {
  const perModel = modelName ? process.env[`OSS_${envKey(modelName)}_SOURCE`] : undefined;
  const value = (perModel || process.env.OSS_LLM_SOURCE || 'aicore').toLowerCase();
  return value === 'destination' ? 'destination' : 'aicore';
}

export async function resolveOssEndpoint(
  modelName: string,
  options: Partial<OssEndpoint> = {}
): Promise<OssEndpoint> {
  if (options.baseUrl) {
    return {
      baseUrl: options.baseUrl, token: options.token, resourceGroup: options.resourceGroup,
      headers: options.headers, modelId: options.modelId
    };
  }

  const key = envKey(modelName);
  const baseUrl = process.env[`OSS_${key}_URL`] || process.env.OSS_LLM_BASE_URL;
  if (baseUrl) {
    return {
      baseUrl,
      token: process.env[`OSS_${key}_TOKEN`] || process.env.OSS_LLM_TOKEN,
      resourceGroup: process.env.OSS_LLM_RESOURCE_GROUP || 'default'
    };
  }

  // Source switch: hosted provider via BTP destination, or self-hosted AI Core.
  if (ossSource(modelName) === 'destination') {
    const mod = await import('./llmDestination');
    const ep = await mod.resolveDestinationEndpoint(modelName);
    if (ep?.baseUrl) return ep;
  } else {
    // Optional: resolve a live AI Core deployment (scripts/deploy-oss-model.ts).
    /* istanbul ignore next -- exercised only with a live AI Core binding */
    try {
      const mod = await import('./aicoreDeployment');
      const ep = await mod.resolveDeployedModel(modelName);
      if (ep?.baseUrl) return ep;
    } catch {
      /* aicoreDeployment unavailable or no binding — fall through to error */
    }
  }

  throw new Error(`OSS_LLM_UNREACHABLE: no endpoint resolved for open-source model "${modelName}"`);
}

/** Build the OpenAI-compatible chat-completions URL, tolerating base URLs that
 *  already include the `/v1` suffix (e.g. OpenRouter's https://openrouter.ai/api/v1). */
export function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** Creates a ChatClient for a self-hosted open-source model (OpenAI-compatible). */
export function createOpenSourceChatClient(
  modelName: string,
  options: Partial<OssEndpoint> & { timeoutMs?: number } = {}
): ChatClient {
  return {
    async run({ messages = [], max_tokens = 2000, temperature = 0.0 }: ChatClientOptions): Promise<ChatClientResponse> {
      const ep = await resolveOssEndpoint(modelName, options);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (ep.token) headers['Authorization'] = `Bearer ${ep.token}`;
      // AI-Resource-Group is an AI Core concept only (omitted for third-party providers).
      if (ep.resourceGroup) headers['AI-Resource-Group'] = ep.resourceGroup;
      // Provider/destination-supplied headers (e.g. forwarded Authorization) win.
      if (ep.headers) Object.assign(headers, ep.headers);

      const res = await fetch(`${chatCompletionsUrl(ep.baseUrl)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: ep.modelId ?? modelName, messages, max_tokens, temperature }),
        signal: AbortSignal.timeout(options.timeoutMs ?? OSS_TIMEOUT_MS)
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OSS_LLM_HTTP_${res.status}: ${body.slice(0, 200)}`);
      }

      const json = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? '';
      const u = json.usage ?? {};
      const tokenUsage: TokenUsage = {
        promptTokens:     u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        totalTokens:      u.total_tokens ?? 0
      };
      return { getContent: () => content, getTokenUsage: () => tokenUsage };
    }
  };
}
