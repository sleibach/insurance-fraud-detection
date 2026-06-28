/**
 * Read-only inspection of the bound AI Core tenant (BYOM feasibility check).
 * Run: cds bind --exec --profile hybrid -- npx tsx scripts/inspect-aicore.ts
 */
import {
  ScenarioApi, ExecutableApi, RepositoryApi, ApplicationApi,
  DockerRegistrySecretApi, ResourceGroupApi, MetaApi
} from '@sap-ai-sdk/ai-api';

const RG = process.env.OSS_LLM_RESOURCE_GROUP || 'default';
const h = { 'AI-Resource-Group': RG };
const log = (...a: unknown[]) => console.log(...a);

async function safe(label: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) { log(`  ${label} FAILED: ${(e as Error).message}`); }
}

async function main(): Promise<void> {
  log(`\n=== AI Core BYOM feasibility (rg: ${RG}) ===\n`);

  await safe('resourceGroups', async () => {
    const r = await ResourceGroupApi.kubesubmitV4ResourcegroupsGetAll().execute();
    log(`Resource groups (${r.resources?.length ?? 0}): ${(r.resources ?? []).map((x: any) => x.resourceGroupId).join(', ')}`);
  });

  await safe('gitRepositories', async () => {
    const r = await RepositoryApi.kubesubmitV4RepositoriesGetAll().execute();
    log(`\nGit repositories (${r.count ?? r.repositories?.length ?? 0}):`);
    for (const x of (r as any).repositories ?? []) log(`  - name=${x.name} url=${x.url} status=${x.status}`);
  });

  await safe('applications', async () => {
    const r = await ApplicationApi.kubesubmitV4ApplicationsGetAll().execute();
    log(`\nArgo applications (${r.count ?? (r as any).applications?.length ?? 0}):`);
    for (const x of (r as any).applications ?? []) log(`  - name=${x.applicationName} repo=${x.repositoryUrl} path=${x.path}`);
  });

  await safe('dockerSecrets', async () => {
    const r = await DockerRegistrySecretApi.kubesubmitV4DockerRegistrySecretsQuery().execute();
    log(`\nDocker registry secrets: ${JSON.stringify((r as any).data ?? r)}`);
  });

  await safe('executables(foundation+custom scenarios)', async () => {
    const scenarios = await ScenarioApi.scenarioQuery(h).execute();
    for (const s of scenarios.resources ?? []) {
      const ex = await ExecutableApi.executableQuery(s.id, {}, h).execute();
      log(`\nExecutables in scenario '${s.id}' (${ex.count ?? ex.resources?.length ?? 0}):`);
      for (const e of ex.resources ?? []) log(`  - id=${e.id} name=${e.name}`);
    }
  });

  await safe('foundation models catalog', async () => {
    const m = await (ScenarioApi as any).scenarioQueryModels('foundation-models', h).execute();
    log(`\nFoundation-models catalog:`);
    for (const x of (m as any).resources ?? []) log(`  - ${x.model}${x.versions ? ' v=' + x.versions.map((v: any) => v.name).join('/') : ''}`);
  });

  await safe('resource plans (meta)', async () => {
    const meta = await MetaApi.metaGet(h).execute();
    log(`\nResource plans / instance types:`);
    log(JSON.stringify((meta as any).resourcePlans ?? meta, null, 2).slice(0, 2000));
  });
}

main().catch(err => { console.error('Inspection failed:', err); process.exit(1); });
