import { DeploymentApi } from '@sap-ai-sdk/ai-api';
const h = { 'AI-Resource-Group': process.env.OSS_LLM_RESOURCE_GROUP || 'default' };
const ids = (process.argv[2] || '').split(',').filter(Boolean);
const maxMin = Number(process.argv[3] || '30');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  const start = Date.now();
  const done = new Set<string>();
  const last: Record<string, string> = {};
  while (Date.now() - start < maxMin * 60000 && done.size < ids.length) {
    const mins = ((Date.now() - start) / 60000).toFixed(1);
    for (const id of ids) {
      if (done.has(id)) continue;
      const d: any = await DeploymentApi.deploymentGet(id, {}, h).execute();
      const line = `status=${d.status} url=${d.deploymentUrl || '-'} ${(d.statusMessage || '').slice(0, 70)}`;
      if (line !== last[id]) console.log(`[+${mins}m] ${id} ${line}`);
      last[id] = line;
      if (d.status === 'RUNNING' && d.deploymentUrl) { console.log(`DEPLOYMENT_RUNNING ${id} ${d.deploymentUrl}`); done.add(id); }
      else if (d.status === 'DEAD' || d.status === 'STOPPED') { console.log(`DEPLOYMENT_${d.status} ${id}`); done.add(id); }
    }
    if (done.size < ids.length) await sleep(20000);
  }
  console.log('MONITOR_DONE');
})().catch(e => console.error('mon err', e.message));
