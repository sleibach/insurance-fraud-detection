/**
 * One-time BYOM onboarding for SAP AI Core (open-source LLM track).
 *
 * Registers the three things the tenant is currently missing so the vLLM
 * ServingTemplate (byom/serving-templates/vllm-template.yaml) can be deployed:
 *   1. a docker registry secret  (so AI Core can pull your pushed vLLM image)
 *   2. a git repository           (where the ServingTemplate YAML is hosted)
 *   3. an application             (syncs the template → scenario/executable)
 *
 * Requires a live `aicore` binding (hybrid). Provide your resources via env:
 *
 *   # Container registry holding the pushed vLLM image
 *   export BYOM_DOCKER_SERVER='https://index.docker.io/v1/'   # or ghcr.io, etc.
 *   export BYOM_DOCKER_USER='<registry-user>'
 *   export BYOM_DOCKER_PASSWORD='<registry-token>'
 *   export BYOM_DOCKER_SECRET='byom-docker-secret'            # name to create
 *
 *   # Git repo containing byom/serving-templates/ (must be reachable by AI Core)
 *   export BYOM_GIT_URL='https://github.com/<you>/<repo>'
 *   export BYOM_GIT_USER='<git-user>'
 *   export BYOM_GIT_TOKEN='<git-PAT>'
 *   export BYOM_GIT_PATH='byom/serving-templates'             # folder with the template
 *   export BYOM_GIT_REVISION='HEAD'
 *
 * Run: cds bind --exec --profile hybrid -- npx tsx scripts/byom-onboard.ts
 */
import { DockerRegistrySecretApi, RepositoryApi, ApplicationApi } from '@sap-ai-sdk/ai-api';

const RG = process.env.OSS_LLM_RESOURCE_GROUP || 'default';
const headers = { 'AI-Resource-Group': RG };
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) { console.error(`Missing required env var ${k}`); process.exit(1); }
  return v;
};

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`✅ ${label}`); }
  catch (e) {
    const msg = (e as Error).message;
    if (/already exists|conflict|409/i.test(msg)) console.log(`• ${label}: already exists (ok)`);
    else console.error(`❌ ${label}: ${msg}`);
  }
}

async function main(): Promise<void> {
  console.log(`\n=== BYOM onboarding (resource group: ${RG}) ===\n`);

  // 1. Docker registry secret
  const secretName = process.env.BYOM_DOCKER_SECRET || 'byom-docker-secret';
  await step(`docker registry secret '${secretName}'`, async () => {
    const server = need('BYOM_DOCKER_SERVER');
    const user = need('BYOM_DOCKER_USER');
    const password = need('BYOM_DOCKER_PASSWORD');
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    const dockerconfigjson = JSON.stringify({ auths: { [server]: { username: user, password, auth } } });
    await DockerRegistrySecretApi.kubesubmitV4DockerRegistrySecretsCreate(
      { name: secretName, data: { '.dockerconfigjson': dockerconfigjson } } as any,
      headers
    ).execute();
  });

  // 2. Git repository
  const repoName = process.env.BYOM_GIT_NAME || 'fraud-byom-templates';
  await step(`git repository '${repoName}'`, async () => {
    await RepositoryApi.kubesubmitV4RepositoriesCreate({
      name: repoName,
      url: need('BYOM_GIT_URL'),
      username: need('BYOM_GIT_USER'),
      password: need('BYOM_GIT_TOKEN')
    }).execute();
  });

  // 3. Application (sync the serving-template folder)
  const appName = process.env.BYOM_APP_NAME || 'fraud-byom-app';
  await step(`application '${appName}'`, async () => {
    await ApplicationApi.kubesubmitV4ApplicationsCreate({
      applicationName: appName,
      repositoryUrl: need('BYOM_GIT_URL'),
      revision: process.env.BYOM_GIT_REVISION || 'HEAD',
      path: process.env.BYOM_GIT_PATH || 'byom/serving-templates'
    }).execute();
  });

  console.log('\nNext: wait for the application to sync (a few minutes), then verify the');
  console.log("scenario 'aicore-opensource' appears, and run scripts/deploy-oss-model.ts.\n");
}

main().catch(err => { console.error('Onboarding failed:', err); process.exit(1); });
