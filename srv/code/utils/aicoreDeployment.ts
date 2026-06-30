import cds from '@sap/cds';
import type { OssEndpoint } from './aiClient';

const LOGGER = cds.log('aicore-deployment');

/**
 * AI Core scenario under which the self-hosted open-source LLMs (BYOM) are
 * deployed. Override with OSS_SCENARIO_ID. See docs/ai/open-source-llm-byom.md.
 */
const OSS_SCENARIO_ID = process.env.OSS_SCENARIO_ID || 'aicore-opensource';
const OSS_RESOURCE_GROUP = process.env.OSS_LLM_RESOURCE_GROUP || 'default';

/**
 * Resolve a RUNNING AI Core deployment for an open-source model and return an
 * OpenAI-compatible endpoint (baseUrl + bearer token + resource group).
 *
 * Best-effort + hybrid-only: requires a live `aicore` service binding. Returns
 * `null` on any failure so callers fall back to a stub (airplane mode). The
 * reliable path for local hybrid runs is to set OSS_<MODEL>_URL / *_TOKEN env
 * vars (printed by scripts/deploy-oss-model.ts).
 */
export async function resolveDeployedModel(modelName: string): Promise<OssEndpoint | null> {
  try {
    const { DeploymentApi } = await import('@sap-ai-sdk/ai-api');
    const headers = { 'AI-Resource-Group': OSS_RESOURCE_GROUP };

    const list = await DeploymentApi
      .deploymentQuery({ scenarioId: OSS_SCENARIO_ID, status: 'RUNNING' }, headers)
      .execute();

    const deployments = (list?.resources ?? []) as Array<Record<string, any>>;
    const match = deployments.find(d => _matchesModel(d, modelName)) ?? deployments[0];

    if (!match?.deploymentUrl) {
      LOGGER.warn('No running AI Core deployment found for model', { modelName, scenario: OSS_SCENARIO_ID });
      return null;
    }

    const token = await getAiCoreToken();
    if (!token) return null;

    LOGGER.info('Resolved AI Core deployment for open-source model', { modelName, url: match.deploymentUrl });
    return { baseUrl: match.deploymentUrl as string, token, resourceGroup: OSS_RESOURCE_GROUP };

  } catch (err) {
    LOGGER.warn('AI Core deployment resolution failed', { modelName, reason: (err as Error).message });
    return null;
  }
}

/** Heuristic match of a deployment to a model name via its config/model details. */
function _matchesModel(deployment: Record<string, any>, modelName: string): boolean {
  const hay = JSON.stringify([
    deployment.configurationName,
    deployment.details?.resources?.backend_details?.model?.name,
    deployment.details
  ]).toLowerCase();
  return hay.includes(modelName.toLowerCase());
}

/** Fetch an AI Core OAuth bearer token from the bound service credentials. */
export async function getAiCoreToken(): Promise<string | undefined> {
  try {
    const { getAiCoreDestination } = await import('@sap-ai-sdk/core');
    const dest = await getAiCoreDestination() as {
      authTokens?: Array<{ value?: string }>;
      headers?: Record<string, string>;
    };
    const fromTokens = dest.authTokens?.[0]?.value;
    const fromHeader = dest.headers?.Authorization?.replace(/^Bearer\s+/i, '');
    return fromTokens || fromHeader;
  } catch (err) {
    LOGGER.warn('Could not obtain AI Core token', { reason: (err as Error).message });
    return undefined;
  }
}
