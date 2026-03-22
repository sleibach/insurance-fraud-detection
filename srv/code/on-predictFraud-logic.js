'use strict';
const cds = require('@sap/cds');
const { RptClient } = require('@sap-ai-sdk/rpt');
const LOGGER = cds.log('on-predictFraud');

// Schema for RPT-1 tabular prediction
const RPT_SCHEMA = [
  { name: 'CLAIM_ID',          dtype: 'string' },
  { name: 'CLAIM_TYPE',        dtype: 'string' },
  { name: 'CLAIM_AMOUNT',      dtype: 'numeric' },
  { name: 'INCIDENT_DATE',     dtype: 'date' },
  { name: 'DESCRIPTION_LENGTH',dtype: 'numeric' },
  { name: 'HAS_ATTACHMENTS',   dtype: 'string' },
  { name: 'FRAUD',             dtype: 'string' }
];

// Few-shot context rows — RPT-1 learns patterns in-context (no pre-training needed)
const CONTEXT_ROWS = [
  { CLAIM_ID: 'ctx-1', CLAIM_TYPE: 'auto',     CLAIM_AMOUNT: 1200,  INCIDENT_DATE: '2024-01-10', DESCRIPTION_LENGTH: 82,  HAS_ATTACHMENTS: 'yes', FRAUD: 'no' },
  { CLAIM_ID: 'ctx-2', CLAIM_TYPE: 'property', CLAIM_AMOUNT: 94000, INCIDENT_DATE: '2024-02-05', DESCRIPTION_LENGTH: 22,  HAS_ATTACHMENTS: 'no',  FRAUD: 'yes' },
  { CLAIM_ID: 'ctx-3', CLAIM_TYPE: 'health',   CLAIM_AMOUNT: 3500,  INCIDENT_DATE: '2024-01-20', DESCRIPTION_LENGTH: 155, HAS_ATTACHMENTS: 'yes', FRAUD: 'no' },
  { CLAIM_ID: 'ctx-4', CLAIM_TYPE: 'auto',     CLAIM_AMOUNT: 72000, INCIDENT_DATE: '2024-03-01', DESCRIPTION_LENGTH: 18,  HAS_ATTACHMENTS: 'no',  FRAUD: 'yes' },
  { CLAIM_ID: 'ctx-5', CLAIM_TYPE: 'property', CLAIM_AMOUNT: 8500,  INCIDENT_DATE: '2023-12-15', DESCRIPTION_LENGTH: 198, HAS_ATTACHMENTS: 'yes', FRAUD: 'no' }
];

module.exports = async function (msg) {
  const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
  const { ID } = msg.data;

  LOGGER.info('Starting fraud prediction', { claimId: ID });

  const [claim, structuredData] = await Promise.all([
    SELECT.one.from(Claims).columns(c => { c('*'); c.attachments(a => a('claim_ID')); }).where({ ID }),
    SELECT.one.from(StructuredData).where({ claim_ID: ID })
  ]);

  if (!structuredData) throw new Error(`No StructuredData for claim ${ID}. Cannot predict.`);

  await UPDATE(Claims).set({ status_code: 'predicting' }).where({ ID });

  try {
    let fraudScore;
    let modelVersion;

    try {
      LOGGER.debug('Calling RPT-1 for fraud prediction', { claimId: ID, claimAmount: structuredData.claimAmount });

      const hasAttachments = (claim?.attachments || []).length > 0 ? 'yes' : 'no';
      const incidentDate   = structuredData.incidentDate || new Date().toISOString().split('T')[0];

      /* c8 ignore next 5 -- defensive parse; malformed rawExtraction is a data issue, not a code path */
      let descriptionLength = 0;
      try {
        const raw = JSON.parse(structuredData.rawExtraction || '{}');
        descriptionLength = (raw.description || '').length;
      } catch {}

      const client = new RptClient('sap-rpt-1-large');
      const res = await client.predictWithSchema(RPT_SCHEMA, {
        prediction_config: {
          target_columns: [{
            name: 'FRAUD',
            prediction_placeholder: '[PREDICT]',
            task_type: 'classification'
          }]
        },
        index_column: 'CLAIM_ID',
        rows: [
          ...CONTEXT_ROWS,
          {
            CLAIM_ID:           ID,
            CLAIM_TYPE:         structuredData.claimType   || 'unknown',
            CLAIM_AMOUNT:       Number(structuredData.claimAmount) || 0,
            INCIDENT_DATE:      incidentDate,
            DESCRIPTION_LENGTH: descriptionLength,
            HAS_ATTACHMENTS:    hasAttachments,
            FRAUD:              '[PREDICT]'
          }
        ]
      });

      // Extract fraud probability from prediction response
      // 'yes' prediction: confidence IS the fraud probability
      // 'no' prediction: fraud probability = 1 - confidence
      const fraudPreds = res.predictions[0]?.FRAUD || [];
      const yesPred    = fraudPreds.find(p => p.prediction === 'yes');
      const noPred     = fraudPreds.find(p => p.prediction === 'no');
      if (yesPred) {
        fraudScore = parseFloat(yesPred.confidence.toFixed(4));
      } else if (noPred) {
        fraudScore = parseFloat((1 - noPred.confidence).toFixed(4));
      } else {
        /* c8 ignore next 1 -- only reachable if RPT-1 returns an unexpected empty array */
        fraudScore = 0.5;
      }

      modelVersion = 'sap-rpt-1-large';
      LOGGER.debug('RPT-1 prediction complete', { claimId: ID, fraudScore, prediction: (yesPred || noPred)?.prediction });

    } catch (rptErr) {
      LOGGER.warn('RPT-1 call failed, using stub scorer', { claimId: ID, reason: rptErr.message });
      fraudScore   = _computeStubScore(structuredData);
      modelVersion = 'rpt1-stub-v1.0';
    }

    await DELETE.from(Predictions).where({ claim_ID: ID });
    await INSERT.into(Predictions).entries({
      claim_ID:            ID,
      fraudScore,
      modelVersion,
      predictionTimestamp: new Date().toISOString()
    });

    await UPDATE(Claims).set({ status_code: 'predicted', lastError: null }).where({ ID });
    LOGGER.info('Fraud prediction complete', { claimId: ID, fraudScore, modelVersion });

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
 * Deterministic stub scorer — used as fallback when RPT-1 is unavailable.
 * Replace with real RPT-1 model call in production.
 */
function _computeStubScore(data) {
  let score = 0.1;
  if (data.claimAmount > 10000) score += 0.3;
  if (data.claimAmount > 50000) score += 0.3;
  if (!data.incidentDate)       score += 0.2;
  return parseFloat(Math.min(score, 1.0).toFixed(4));
}
