import cds from '@sap/cds';
import { RptClient } from '@sap-ai-sdk/rpt';
import type { PredictResponsePayload } from '@sap-ai-sdk/rpt';
import type { StructuredDataRecord, StructuredDataFieldRecord, RunStatus } from '../types';
import { loadRunConfig, classifyPredictModel } from './utils/runConfig';
import { predictWithMl } from './utils/mlClient';

const LOGGER = cds.log('on-predictFraud');

interface PredictOutcome {
  fraudScore: number;
  predictedClass: 'yes' | 'no';
  modelVersion: string;
  status: RunStatus;
  latencyMs: number;
}

interface PredictContext {
  ID: string;
  structuredData: StructuredDataRecord;
  sdFields: StructuredDataFieldRecord[];
  hasAttachments: boolean;
  stubScore: number;
}

export default async function (msg: cds.Event): Promise<void> {
  const { Claims, StructuredData, StructuredDataFields, Predictions } = cds.entities('ClaimService');
  const { ID } = msg.data as { ID: string };

  const runConfig = await loadRunConfig(ID, msg.data as Record<string, unknown>);
  LOGGER.info('Starting fraud prediction', { claimId: ID, predictModels: runConfig.predictModels });

  const [claim, structuredData] = await Promise.all([
    SELECT.one.from(Claims).columns((c: any) => { c('*'); c.attachments((a: any) => a('claim_ID')); }).where({ ID }),
    SELECT.one.from(StructuredData).where({ claim_ID: ID }) as unknown as Promise<StructuredDataRecord | null>
  ]);

  if (!structuredData) throw new Error(`No StructuredData for claim ${ID}. Cannot predict.`);

  await UPDATE(Claims).set({ status_code: 'predicting' }).where({ ID });

  try {
    /* istanbul ignore next -- claim.attachments is always present via CAP expand */
    const hasAttachments = (claim?.attachments || []).length > 0;
    const sdFields = await SELECT.from(StructuredDataFields)
      .where({ structuredData_ID: structuredData.ID }) as StructuredDataFieldRecord[];
    const stubScore = _computeStubScore(structuredData);

    const ctx: PredictContext = { ID, structuredData, sdFields, hasAttachments, stubScore };

    // Run every requested predict model in parallel (RPT-1 + custom ML).
    const outcomes = await Promise.all(
      runConfig.predictModels.map(model => _runOnePrediction(model, ctx))
    );

    const now = new Date().toISOString();
    const rows = runConfig.predictModels.map((modelName, i) => {
      const cls = classifyPredictModel(modelName);
      const o = outcomes[i];
      return {
        claim_ID:            ID,
        track:               cls.track,
        provider:            cls.provider,
        modelName,
        fraudScore:          o.fraudScore,
        predictedClass:      o.predictedClass,
        modelVersion:        o.modelVersion,
        status:              o.status,
        latencyMs:           o.latencyMs,
        predictionTimestamp: now
      };
    });

    await DELETE.from(Predictions).where({ claim_ID: ID });
    await INSERT.into(Predictions).entries(rows);

    // Denormalized comparison summaries for the List Report.
    const propRow   = rows.find(r => r.track === 'proprietary');
    const customRow = rows.find(r => r.track === 'custom');

    await UPDATE(Claims).set({
      status_code:           'predicted',
      lastError:             null,
      fraudScoreProprietary: propRow?.fraudScore   ?? null,
      fraudScoreCustom:      customRow?.fraudScore  ?? null
    }).where({ ID });

    LOGGER.info('Fraud prediction complete', {
      claimId: ID,
      predictions: rows.map(r => ({ model: r.modelName, score: r.fraudScore, status: r.status }))
    });

    // Chain to evaluation, carrying the (paired) evaluation config forward.
    const ClaimService = await cds.connect.to('ClaimService');
    await cds.outboxed(ClaimService).emit('EvaluateClaim', { ID, evaluations: runConfig.evaluations });

  } catch (err: unknown) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: (err as Error).message }).where({ ID });
    throw err;
  }
};

// ── Per-model dispatch ──────────────────────────────────────────────────────

async function _runOnePrediction(model: string, ctx: PredictContext): Promise<PredictOutcome> {
  const { provider } = classifyPredictModel(model);
  if (provider === 'sap-rpt') {
    return _runRptPrediction(model, ctx);
  }
  // Custom self-hosted ML model via the local FastAPI.
  const r = await predictWithMl(model, ctx.sdFields, { fallbackScore: ctx.stubScore });
  return {
    fraudScore:     r.fraudScore,
    predictedClass: r.predictedClass,
    modelVersion:   r.status === 'success' ? `custom-ml/${model}` : `custom-ml/${model}-${r.status}`,
    status:         r.status,
    latencyMs:      r.latencyMs
  };
}

async function _runRptPrediction(model: string, ctx: PredictContext): Promise<PredictOutcome> {
  const started = Date.now();
  const { ID, structuredData, sdFields, hasAttachments, stubScore } = ctx;
  try {
    LOGGER.debug('Calling RPT-1 for fraud prediction', { claimId: ID, claimAmount: structuredData.claimAmount });

    const claimType = structuredData.claimType ?? 'auto';
    const contextRows = await fetchContextRows(claimType, sdFields);
    LOGGER.debug('Training context loaded', { claimId: ID, contextCount: contextRows.length });

    const schema = buildRptSchema(sdFields, hasAttachments);
    const fieldNames = sdFields.map(f => f.fieldName);
    const trainingRptRows = contextRows.map((r, i) => ({
      CLAIM_ID: `ctx-${i}`,
      ...Object.fromEntries(fieldNames.map(k => [k, (r as Record<string, unknown>)[k] ?? ''])),
      HAS_ATTACHMENTS: 'unknown',
      FRAUD: r.fraud as string
    }));

    const predictionRow: Record<string, string | number> = {
      CLAIM_ID: ID,
      ...Object.fromEntries(sdFields.map(f => [f.fieldName, f.fieldValue ?? ''])),
      HAS_ATTACHMENTS: hasAttachments ? 'yes' : 'no',
      FRAUD: '[PREDICT]'
    };

    const client = new RptClient(model as 'sap-rpt-1-large');
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const res = await (client as any).predictWithSchema(schema, {
      prediction_config: {
        target_columns: [{
          name: 'FRAUD',
          prediction_placeholder: '[PREDICT]',
          task_type: 'classification'
        }]
      },
      index_column: 'CLAIM_ID',
      rows: [...trainingRptRows, predictionRow]
    });

    type PredEntry = NonNullable<PredictResponsePayload['predictions'][number][string]>;
    /* istanbul ignore next -- RPT-1 always returns predictions[0] for a single-row request */
    const fraudPreds = (res.predictions[0]?.FRAUD || []) as Extract<PredEntry, unknown[]>;
    const yesPred    = fraudPreds.find((p: any) => p.prediction === 'yes');
    const noPred     = fraudPreds.find((p: any) => p.prediction === 'no');

    let fraudScore: number;
    let predictedClass: 'yes' | 'no';
    if (yesPred) {
      /* istanbul ignore next -- RPT-1 always returns a confidence score */
      fraudScore = parseFloat(((yesPred as any).confidence ?? 0.5).toFixed(4));
      predictedClass = 'yes';
    } else if (noPred) {
      /* istanbul ignore next -- RPT-1 always returns a confidence score */
      fraudScore = parseFloat((1 - ((noPred as any).confidence ?? 0.5)).toFixed(4));
      predictedClass = 'no';
    } else /* istanbul ignore next -- only reachable if RPT-1 returns an unexpected empty array */ {
      fraudScore = 0.5;
      predictedClass = 'no';
    }

    LOGGER.debug('RPT-1 prediction complete', { claimId: ID, fraudScore, prediction: (yesPred || noPred) });
    return { fraudScore, predictedClass, modelVersion: model, status: 'success', latencyMs: Date.now() - started };

  } catch (rptErr: unknown) {
    LOGGER.warn('RPT-1 call failed, using stub scorer', { claimId: ID, reason: (rptErr as Error).message });
    return {
      fraudScore:     stubScore,
      predictedClass: stubScore >= 0.5 ? 'yes' : 'no',
      modelVersion:   'rpt1-stub-v1.0',
      status:         'stub',
      latencyMs:      Date.now() - started
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps each claim type to the name of its training-data entity in ClaimService.
 * To add a new claim type:
 *   1. Create a FraudXxxTrainingData entity in db/schema.cds (same column shape)
 *   2. Generate its seed CSV with scripts/split-training-data.ts (or equivalent)
 *   3. Add an entry here.
 */
const TRAINING_ENTITY_BY_TYPE: Record<string, string> = {
  auto: 'FraudAutoTrainingData',
  // property: 'FraudPropertyTrainingData',
  // health:   'FraudHealthTrainingData',
  // life:     'FraudLifeTrainingData',
  // travel:   'FraudTravelTrainingData',
  // liability:'FraudLiabilityTrainingData',
};

/**
 * Returns 100 balanced training rows (50 fraud + 50 non-fraud) for the given
 * claim type, sorted by rowNum for deterministic results.
 * Returns an empty array if no training data exists for the claim type yet —
 * the predict step will fall back to the stub scorer.
 */
async function fetchContextRows(
  claimType: string,
  _fields: StructuredDataFieldRecord[]
): Promise<Array<Record<string, unknown>>> {
  const entityName = TRAINING_ENTITY_BY_TYPE[claimType];
  if (!entityName) {
    LOGGER.warn('No training data registered for claim type — skipping context rows', { claimType });
    return [];
  }
  const entities = cds.entities('ClaimService') as Record<string, unknown>;
  const entity = entities[entityName];
  if (!entity) {
    LOGGER.warn('Training entity not found in service — skipping context rows', { entityName, claimType });
    return [];
  }
  const [fraudRows, cleanRows] = await Promise.all([
    SELECT.from(entity as any).where({ fraud: 'yes' }).orderBy('rowNum asc').limit(50),
    SELECT.from(entity as any).where({ fraud: 'no'  }).orderBy('rowNum asc').limit(50)
  ]);
  return [...fraudRows, ...cleanRows];
}

/**
 * Builds the RPT-1 column schema from the claim's extracted field names.
 * Numeric fields from the training data are declared as 'numeric'; everything
 * else is 'string'. A shared HAS_ATTACHMENTS column is always appended.
 */
function buildRptSchema(fields: StructuredDataFieldRecord[], _hasAttachments: boolean) {
  const NUMERIC_FIELDS = new Set(['weekOfMonth', 'weekOfMonthClaimed', 'age', 'policyNumber',
    'repNumber', 'deductible', 'driverRating', 'year']);

  return [
    { name: 'CLAIM_ID',        dtype: 'string'  as const },
    ...fields.map(f => ({
      name:  f.fieldName,
      dtype: NUMERIC_FIELDS.has(f.fieldName) ? 'numeric' as const : 'string' as const
    })),
    { name: 'HAS_ATTACHMENTS', dtype: 'string'  as const },
    { name: 'FRAUD',           dtype: 'string'  as const }
  ];
}

/**
 * Deterministic stub scorer — used as fallback when a predict model is unavailable.
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
