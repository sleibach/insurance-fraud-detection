import { DeploymentApi } from '@sap-ai-sdk/ai-api';
const h = { 'AI-Resource-Group': process.env.OSS_LLM_RESOURCE_GROUP || 'default' };
const id = process.argv[2];
(async () => {
  const d: any = await DeploymentApi.deploymentGet(id, {}, h).execute();
  console.log('STATUS', d.status, 'url', d.deploymentUrl || '-', 'msg', d.statusMessage || '-');
  console.log('statusDetails', JSON.stringify(d.statusDetails || {}).slice(0, 400));
  try {
    const lg: any = await DeploymentApi.kubesubmitV4DeploymentsGetLogs(id, { $top: 20 } as any, h).execute();
    const items = lg?.data?.result || lg?.result || [];
    console.log('LOGS', items.length);
    for (const x of items.slice(-12)) console.log('  ', (x.msg || x.message || JSON.stringify(x)).toString().slice(0, 180));
  } catch (e) { console.log('logs err', (e as Error).message); }
})().catch(e => console.error('err', e.message));
