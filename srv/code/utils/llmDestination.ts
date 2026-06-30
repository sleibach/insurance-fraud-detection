import cds from '@sap/cds';
import type { OssEndpoint } from './aiClient';

const LOGGER = cds.log('llm-destination');

/**
 * Third-party (OpenRouter) source for the open-source evaluator models, consumed
 * through a single shared BTP destination. Selected when OSS_LLM_SOURCE (or the
 * per-model OSS_<MODEL>_SOURCE) is set to 'destination'. This lets us run the
 * open-source track on a hosted provider while the self-hosted AI Core GPU
 * deployments are unschedulable — and flip back to AI Core with one env var.
 *
 * The destination (default name 'openrouter-llm') is an HTTP destination whose
 * URL points at the OpenAI-compatible base (https://openrouter.ai/api/v1) and
 * which carries the provider API key as a forwarded header via the additional
 * property `URL.headers.Authorization=Bearer <key>` (see scripts/create-destination.ts).
 */

const DEFAULT_DESTINATION = 'openrouter-llm';

/** Internal pipeline model id → OpenRouter model id. Override per model with
 *  OSS_<MODEL>_PROVIDER_ID (e.g. OSS_GPT_OSS_120B_PROVIDER_ID). */
const MODEL_ID_MAP: Record<string, string> = {
  'gpt-oss-120b': 'openai/gpt-oss-120b',
  'gpt-oss-20b':  'openai/gpt-oss-20b',
  'gemma-3-27b':  'google/gemma-3-27b-it'
};

function envKey(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** Map an internal model name to the provider's model id (env-overridable). */
export function mapModelId(modelName: string): string {
  return process.env[`OSS_${envKey(modelName)}_PROVIDER_ID`] || MODEL_ID_MAP[modelName] || modelName;
}

/**
 * Extract the headers a BTP destination should forward. The destination service
 * returns custom forwarded headers as `URL.headers.<Name>` properties; we also
 * honour a resolved Authorization from authTokens/headers if present.
 */
function extractHeaders(dest: Record<string, any>): Record<string, string> {
  const headers: Record<string, string> = {};

  // Forwarded headers configured as `URL.headers.<Name>` additional properties.
  const props = (dest.originalProperties ?? dest) as Record<string, unknown>;
  for (const [k, v] of Object.entries(props)) {
    const m = /^URL\.headers\.(.+)$/i.exec(k);
    if (m && typeof v === 'string') headers[m[1]] = v;
  }

  // Headers/tokens the Cloud SDK already resolved on the destination.
  if (dest.headers && typeof dest.headers === 'object') {
    for (const [k, v] of Object.entries(dest.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v;
    }
  }
  const tokenValue = dest.authTokens?.[0]?.value as string | undefined;
  if (tokenValue && !headers['Authorization']) headers['Authorization'] = `Bearer ${tokenValue}`;

  return headers;
}

/**
 * Resolve an OpenAI-compatible endpoint for an open-source model from the shared
 * BTP destination. Returns `null` on any failure so the caller falls back to a
 * stub evaluation (airplane mode) — mirrors aicoreDeployment.resolveDeployedModel.
 */
export async function resolveDestinationEndpoint(modelName: string): Promise<OssEndpoint | null> {
  const destinationName = process.env.OSS_LLM_DESTINATION || DEFAULT_DESTINATION;
  try {
    const { getDestination } = await import('@sap-cloud-sdk/connectivity');
    const dest = (await getDestination({ destinationName })) as Record<string, any> | null;

    if (!dest?.url) {
      LOGGER.warn('No BTP destination resolved for open-source model', { modelName, destinationName });
      return null;
    }

    const headers = extractHeaders(dest);
    const modelId = mapModelId(modelName);
    LOGGER.info('Resolved BTP destination for open-source model', { modelName, modelId, destinationName, url: dest.url });
    return { baseUrl: dest.url as string, headers, modelId };

  } catch (err) {
    LOGGER.warn('BTP destination resolution failed', { modelName, destinationName, reason: (err as Error).message });
    return null;
  }
}
