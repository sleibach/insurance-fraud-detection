/**
 * Deploy a self-hosted open-source LLM (BYOM) to SAP AI Core via the vLLM
 * ServingTemplate in byom/serving-templates/vllm-template.yaml.
 *
 * PREREQUISITES (one-time, see byom/README.md) — these need YOUR resources:
 *   1. A vLLM image pushed to a container registry (byom/vllm-server/Dockerfile).
 *   2. A docker registry secret + the serving-template git repo onboarded as an
 *      Application in AI Core — run: npx tsx scripts/byom-onboard.ts
 *   3. GPU instance types available on the (extended) plan.
 *
 * Usage (requires a live `aicore` binding — hybrid profile):
 *   cds bind --exec --profile hybrid -- npx tsx scripts/deploy-oss-model.ts gpt-oss-120b --wait
 *   cds bind --exec --profile hybrid -- npx tsx scripts/deploy-oss-model.ts gpt-oss-20b
 *   cds bind --exec --profile hybrid -- npx tsx scripts/deploy-oss-model.ts gemma-3-27b --wait
 *
 * What it does:
 *   1. Creates an AI Core *configuration* (model + GPU instanceType + vLLM args;
 *      scale-to-zero via minReplicas=0) in the BYOM scenario.
 *   2. Creates a *deployment* from that configuration.
 *   3. (--wait) Polls until RUNNING and prints the OpenAI-compatible
 *      deploymentUrl plus the env vars the pipeline reads.
 */
import { ConfigurationApi, DeploymentApi } from '@sap-ai-sdk/ai-api';

const SCENARIO_ID    = process.env.OSS_SCENARIO_ID    || 'aicore-opensource';
const EXECUTABLE_ID  = process.env.OSS_EXECUTABLE_ID  || 'aicore-opensource-vllm';
const RESOURCE_GROUP = process.env.OSS_LLM_RESOURCE_GROUP || 'default';

// Default to the official PUBLIC vLLM image — no build/push needed; the
// ServingTemplate redirects caches to /tmp so it runs under AI Core's UID.
// Override BYOM_IMAGE only if you push a custom image.
const IMAGE         = process.env.BYOM_IMAGE         || 'docker.io/vllm/vllm-openai:v0.10.2';
const DOCKER_SECRET = process.env.BYOM_DOCKER_SECRET || 'byom-docker-secret';
const HF_TOKEN      = process.env.HF_TOKEN           || '';

interface OssModelSpec {
  hfModel: string;
  /** Flexible GPU instance type id on the extended plan (tenant-specific). */
  instanceType: string;
  /** Legacy fallback when instanceType is empty. */
  resourcePlan: string;
  quantization: string;
  dataType: string;
  tensorParallelSize: string;
  maxModelLen: string;
}

/** BYOM registry — all three self-hosted on AI Core flexible GPU instances. */
const MODELS: Record<string, OssModelSpec> = {
  // ~80 GB MXFP4 → single H100 80 GB.
  'gpt-oss-120b': {
    hfModel: 'openai/gpt-oss-120b',
    instanceType: process.env.OSS_INSTANCE_120B || '',
    resourcePlan: process.env.OSS_PLAN_120B || 'infer.l',
    quantization: 'mxfp4', dataType: 'bfloat16', tensorParallelSize: '1', maxModelLen: '8192'
  },
  // ~16 GB MXFP4 → L4 24 GB.
  'gpt-oss-20b': {
    hfModel: 'openai/gpt-oss-20b',
    instanceType: process.env.OSS_INSTANCE_20B || '',
    resourcePlan: process.env.OSS_PLAN_20B || 'infer.l',
    quantization: 'mxfp4', dataType: 'bfloat16', tensorParallelSize: '1', maxModelLen: '8192'
  },
  // 27B → L40S 48 GB with fp8 (bf16 ~54 GB won't fit 48 GB). Gated model → HF_TOKEN.
  'gemma-3-27b': {
    hfModel: 'google/gemma-3-27b-it',
    instanceType: process.env.OSS_INSTANCE_GEMMA || '',
    resourcePlan: process.env.OSS_PLAN_GEMMA || 'infer.l',
    quantization: 'fp8', dataType: 'bfloat16', tensorParallelSize: '1', maxModelLen: '8192'
  }
};

const headers = { 'AI-Resource-Group': RESOURCE_GROUP };

async function main(): Promise<void> {
  const key = process.argv[2];
  const wait = process.argv.includes('--wait');

  if (!key || !MODELS[key]) {
    console.error(`Usage: deploy-oss-model.ts <${Object.keys(MODELS).join('|')}> [--wait]`);
    process.exit(1);
  }
  const spec = MODELS[key];
  console.log(`\nDeploying open-source model "${key}" to AI Core (BYOM / vLLM)`);
  console.log(`  image=${IMAGE}`);
  console.log(`  scenario=${SCENARIO_ID} executable=${EXECUTABLE_ID} rg=${RESOURCE_GROUP}`);
  console.log(`  model=${spec.hfModel} instanceType=${spec.instanceType || '(resourcePlan ' + spec.resourcePlan + ')'} quant=${spec.quantization}\n`);

  // 1. Configuration — scale-to-zero (minReplicas 0) keeps idle GPU cost at zero.
  const config = await ConfigurationApi.configurationCreate({
    name: `oss-${key}-${Date.now()}`,
    executableId: EXECUTABLE_ID,
    scenarioId: SCENARIO_ID,
    parameterBindings: [
      { key: 'modelName',            value: spec.hfModel },
      { key: 'image',                value: IMAGE },
      { key: 'dockerSecret',         value: DOCKER_SECRET },
      { key: 'instanceType',         value: spec.instanceType },
      { key: 'resourcePlan',         value: spec.resourcePlan },
      { key: 'dataType',             value: spec.dataType },
      { key: 'quantization',         value: spec.quantization },
      { key: 'tensorParallelSize',   value: spec.tensorParallelSize },
      { key: 'maxModelLen',          value: spec.maxModelLen },
      { key: 'minReplicas',          value: '0' },
      { key: 'maxReplicas',          value: '1' },
      { key: 'hfToken',              value: HF_TOKEN }
    ],
    inputArtifactBindings: []
  }, headers).execute();

  console.log(`Created configuration: ${config.id}`);

  // 2. Deployment
  const dep = await DeploymentApi.deploymentCreate({ configurationId: config.id }, headers).execute();
  console.log(`Created deployment: ${dep.id} (status: ${dep.status})`);

  if (!wait) {
    console.log('\nPass --wait to poll until RUNNING and print the endpoint.');
    return;
  }

  const deploymentUrl = await pollUntilRunning(dep.id);
  if (!deploymentUrl) { process.exit(2); }

  const envKey = key.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  console.log('\n✅ Deployment RUNNING. Export these to let the pipeline reach it:\n');
  console.log(`  export OSS_${envKey}_URL='${deploymentUrl}'`);
  console.log(`  export OSS_LLM_RESOURCE_GROUP='${RESOURCE_GROUP}'`);
  console.log('\n(token is fetched automatically from the aicore binding)\n');
}

async function pollUntilRunning(deploymentId: string, timeoutMs = 30 * 60_000): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await DeploymentApi.deploymentGet(deploymentId, {}, headers).execute();
    process.stdout.write(`\r  status=${d.status} url=${d.deploymentUrl ?? '(pending)'}      `);
    if (d.status === 'RUNNING' && d.deploymentUrl) return d.deploymentUrl;
    if (d.status === 'DEAD' || d.status === 'STOPPED') {
      console.error(`\nDeployment ended in status ${d.status}`);
      return undefined;
    }
    await new Promise(r => setTimeout(r, 15_000));
  }
  console.error('\nTimed out waiting for RUNNING');
  return undefined;
}

main().catch(err => { console.error('Deployment failed:', err); process.exit(1); });
