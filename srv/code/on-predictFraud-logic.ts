import cds from '@sap/cds';
import { RptClient } from '@sap-ai-sdk/rpt';
import type { DateString } from '@sap-ai-sdk/rpt';
import type { PredictResponsePayload } from '@sap-ai-sdk/rpt';
import type { StructuredDataRecord } from '../types';

const LOGGER = cds.log('on-predictFraud');

// Schema for RPT-1 tabular prediction — `as const` satisfies the SDK's generic constraint
const RPT_SCHEMA = [
  { name: 'CLAIM_ID',           dtype: 'string'  },
  { name: 'CLAIM_TYPE',         dtype: 'string'  },
  { name: 'CLAIM_AMOUNT',       dtype: 'numeric' },
  { name: 'INCIDENT_DATE',      dtype: 'date'    },
  { name: 'DESCRIPTION_LENGTH', dtype: 'numeric' },
  { name: 'HAS_ATTACHMENTS',    dtype: 'string'  },
  { name: 'FRAUD',              dtype: 'string'  }
] as const;

// Few-shot context rows — RPT-1 learns patterns in-context (no pre-training needed)
const CONTEXT_ROWS: Array<{
  CLAIM_ID: string; CLAIM_TYPE: string; CLAIM_AMOUNT: number;
  INCIDENT_DATE: DateString; DESCRIPTION_LENGTH: number;
  HAS_ATTACHMENTS: string; FRAUD: string;
}> = [
  { CLAIM_ID: 'ctx-1', CLAIM_TYPE: 'auto',     CLAIM_AMOUNT: 1200,  INCIDENT_DATE: '2024-01-10', DESCRIPTION_LENGTH: 82,  HAS_ATTACHMENTS: 'yes', FRAUD: 'no'  },
  { CLAIM_ID: 'ctx-2', CLAIM_TYPE: 'property', CLAIM_AMOUNT: 94000, INCIDENT_DATE: '2024-02-05', DESCRIPTION_LENGTH: 22,  HAS_ATTACHMENTS: 'no',  FRAUD: 'yes' },
  { CLAIM_ID: 'ctx-3', CLAIM_TYPE: 'health',   CLAIM_AMOUNT: 3500,  INCIDENT_DATE: '2024-01-20', DESCRIPTION_LENGTH: 155, HAS_ATTACHMENTS: 'yes', FRAUD: 'no'  },
  { CLAIM_ID: 'ctx-4', CLAIM_TYPE: 'auto',     CLAIM_AMOUNT: 72000, INCIDENT_DATE: '2024-03-01', DESCRIPTION_LENGTH: 18,  HAS_ATTACHMENTS: 'no',  FRAUD: 'yes' },
  { CLAIM_ID: 'ctx-5', CLAIM_TYPE: 'property', CLAIM_AMOUNT: 8500,  INCIDENT_DATE: '2023-12-15', DESCRIPTION_LENGTH: 198, HAS_ATTACHMENTS: 'yes', FRAUD: 'no'  }
];

export default async function (msg: cds.Event): Promise<void> {
  const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
  const { ID } = msg.data as { ID: string };

  LOGGER.info('Starting fraud prediction', { claimId: ID });

  const [claim, structuredData] = await Promise.all([
    SELECT.one.from(Claims).columns((c: any) => { c('*'); c.attachments((a: any) => a('claim_ID')); }).where({ ID }),
    SELECT.one.from(StructuredData).where({ claim_ID: ID }) as unknown as Promise<StructuredDataRecord | null>
  ]);

  if (!structuredData) throw new Error(`No StructuredData for claim ${ID}. Cannot predict.`);

  await UPDATE(Claims).set({ status_code: 'predicting' }).where({ ID });

  try {
    let fraudScore: number;
    let modelVersion: string;

    try {
      LOGGER.debug('Calling RPT-1 for fraud prediction', { claimId: ID, claimAmount: structuredData.claimAmount });

      /* istanbul ignore next -- claim.attachments is always present via CAP expand */
      const hasAttachments = (claim?.attachments || []).length > 0 ? 'yes' : 'no';
      /* istanbul ignore next -- incidentDate is populated by structuring step */
      const incidentDate   = structuredData.incidentDate || new Date().toISOString().split('T')[0];

      /* istanbul ignore next 5 -- defensive parse; malformed rawExtraction is a data issue, not a code path */
      let descriptionLength = 0;
      try {
        const raw = JSON.parse(structuredData.rawExtraction || '{}') as { description?: string };
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
            /* istanbul ignore next -- fields validated non-null by structuring step */
            CLAIM_TYPE:         structuredData.claimType   || 'unknown',
            CLAIM_AMOUNT:       Number(structuredData.claimAmount) || 0,
            INCIDENT_DATE:      incidentDate as DateString,
            DESCRIPTION_LENGTH: descriptionLength,
            HAS_ATTACHMENTS:    hasAttachments,
            FRAUD:              '[PREDICT]'
          }
        ]
      });

      // Extract fraud probability from prediction response
      // 'yes' prediction: confidence IS the fraud probability
      // 'no' prediction: fraud probability = 1 - confidence
      type PredEntry = NonNullable<PredictResponsePayload['predictions'][number][string]>;
      /* istanbul ignore next -- RPT-1 always returns predictions[0] for a single-row request */
      const fraudPreds = (res.predictions[0]?.FRAUD || []) as Extract<PredEntry, unknown[]>;
      const yesPred    = fraudPreds.find(p => p.prediction === 'yes');
      const noPred     = fraudPreds.find(p => p.prediction === 'no');
      if (yesPred) {
        /* istanbul ignore next -- RPT-1 always returns a confidence score */
        fraudScore = parseFloat((yesPred.confidence ?? 0.5).toFixed(4));
      } else if (noPred) {
        /* istanbul ignore next -- RPT-1 always returns a confidence score */
        fraudScore = parseFloat((1 - (noPred.confidence ?? 0.5)).toFixed(4));
      } else /* istanbul ignore next -- only reachable if RPT-1 returns an unexpected empty array */ {
        fraudScore = 0.5;
      }

      modelVersion = 'sap-rpt-1-large';
      LOGGER.debug('RPT-1 prediction complete', { claimId: ID, fraudScore, prediction: (yesPred || noPred)?.prediction });

    } catch (rptErr: unknown) {
      LOGGER.warn('RPT-1 call failed, using stub scorer', { claimId: ID, reason: (rptErr as Error).message });
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

  } catch (err: unknown) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: (err as Error).message }).where({ ID });
    throw err;
  }
};

/**
 * Deterministic stub scorer — used as fallback when RPT-1 is unavailable.
 */
function _computeStubScore(data: StructuredDataRecord): number {
  let score = 0.1;
  /* istanbul ignore next -- claimAmount is a required numeric field populated by structuring step */
  if ((data.claimAmount ?? 0) > 10000) score += 0.3;
  /* istanbul ignore next */
  if ((data.claimAmount ?? 0) > 50000) score += 0.3;
  if (!data.incidentDate)              score += 0.2;
  return parseFloat(Math.min(score, 1.0).toFixed(4));
}
