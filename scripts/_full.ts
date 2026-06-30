import { DeploymentApi } from '@sap-ai-sdk/ai-api';
const h = { 'AI-Resource-Group': process.env.OSS_LLM_RESOURCE_GROUP || 'default' };
(async () => {
  const d: any = await DeploymentApi.deploymentGet(process.argv[2], {}, h).execute();
  console.log(JSON.stringify({
    status: d.status, targetStatus: d.targetStatus, deploymentUrl: d.deploymentUrl,
    statusMessage: d.statusMessage, statusDetails: d.statusDetails,
    submissionTime: d.submissionTime, startTime: d.startTime,
    lastOperation: d.lastOperation, latestRunningConfigurationId: d.latestRunningConfigurationId
  }, null, 2));
})().catch(e => console.error('err', e.message));
