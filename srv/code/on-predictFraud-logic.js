'use strict';
const cds = require('@sap/cds');
const LOGGER = cds.log('on-predictFraud');

module.exports = async function (msg) {
  const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
  const { ID } = msg.data;

  LOGGER.info('Starting fraud prediction', { claimId: ID });

  const structuredData = await SELECT.one.from(StructuredData).where({ claim_ID: ID });
  if (!structuredData) throw new Error(`No StructuredData for claim ${ID}. Cannot predict.`);

  await UPDATE(Claims).set({ status_code: 'predicting' }).where({ ID });

  try {
    // TODO: Replace stub with real SAP RPT-1 Table Transformer call via @sap-cloud-sdk/http-client
    LOGGER.debug('Computing fraud score', { claimId: ID, claimAmount: structuredData.claimAmount, incidentDate: structuredData.incidentDate });
    const fraudScore = _computeStubScore(structuredData);
    LOGGER.debug('Fraud score computed', { claimId: ID, fraudScore });

    await DELETE.from(Predictions).where({ claim_ID: ID });
    await INSERT.into(Predictions).entries({
      claim_ID:            ID,
      fraudScore:          fraudScore,
      modelVersion:        'rpt1-stub-v1.0',
      predictionTimestamp: new Date().toISOString()
    });

    await UPDATE(Claims).set({ status_code: 'predicted', lastError: null }).where({ ID });
    LOGGER.info('Fraud prediction complete', { claimId: ID, fraudScore, modelVersion: 'rpt1-stub-v1.0' });

    // Chain to next pipeline step
    const ClaimService = await cds.connect.to('ClaimService');
    await cds.outboxed(ClaimService).emit('EvaluateClaim', { ID });

  } catch (err) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: err.message }).where({ ID });
    throw err;
  }
};

/**
 * Deterministic stub scorer — returns a fraud probability based on simple heuristics.
 * Replace with real RPT-1 model call in production.
 */
function _computeStubScore(data) {
  let score = 0.1;
  if (data.claimAmount > 10000) score += 0.3;
  if (data.claimAmount > 50000) score += 0.3;
  if (!data.incidentDate)       score += 0.2;
  return parseFloat(Math.min(score, 1.0).toFixed(4));
}
