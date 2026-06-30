import cds from '@sap/cds';
import type {
  EvaluationRunInput, RunConfig, ModelRunConfigRecord, ModelTrack
} from '../../types';

const LOGGER = cds.log('run-config');

// ─── Defaults: two isolated tracks (proprietary vs custom/open-source) ─────────
//
// Track A (proprietary): SAP RPT-1 prediction  → Claude (Opus) evaluation
// Track B (open-source): custom ML (gradient boosting) prediction → OSS LLM eval
//
// `inputPredictModel` pairs each evaluation to exactly one prediction so the two
// lanes stay isolated and comparable side-by-side in the UI.

export const PROPRIETARY_PREDICT_MODEL = 'sap-rpt-1-large';
export const DEFAULT_CUSTOM_PREDICT_MODEL = 'gbc'; // gradient boosting classifier
export const DEFAULT_PROPRIETARY_EVAL_MODEL = 'anthropic--claude-4.6-opus';
export const DEFAULT_OPENSOURCE_EVAL_MODEL = 'gpt-oss-120b';

export const DEFAULT_PREDICT_MODELS: string[] = [
  PROPRIETARY_PREDICT_MODEL,
  DEFAULT_CUSTOM_PREDICT_MODEL
];

export const DEFAULT_EVALUATIONS: EvaluationRunInput[] = [
  { model: DEFAULT_PROPRIETARY_EVAL_MODEL, inputPredictModel: PROPRIETARY_PREDICT_MODEL },
  { model: DEFAULT_OPENSOURCE_EVAL_MODEL,  inputPredictModel: DEFAULT_CUSTOM_PREDICT_MODEL }
];

/** Custom ML algorithms exposed by the local FastAPI (ml/src/main.py). */
export const ML_MODELS = new Set(['rf', 'svm', 'lr', 'knn', 'nb', 'gbc']);

export interface ModelClassification {
  track: ModelTrack;
  provider: string;
}

/** Classify a predict model into its track + provider. */
export function classifyPredictModel(model: string): ModelClassification {
  if (/^sap-rpt/i.test(model)) return { track: 'proprietary', provider: 'sap-rpt' };
  // Everything else is treated as a custom (self-hosted) ML model.
  return { track: 'custom', provider: 'custom-ml' };
}

/**
 * Classify an evaluate (LLM) model into its track + provider.
 * Anthropic models are the proprietary lane; any other model is an open-source
 * model whose provider reflects where it is served: a hosted third party via a
 * BTP destination ('openrouter') when OSS_LLM_SOURCE/OSS_<MODEL>_SOURCE is
 * 'destination', otherwise self-hosted on AI Core (BYOM, 'aicore-byom').
 */
export function classifyEvalModel(model: string): ModelClassification {
  if (/^anthropic/i.test(model)) return { track: 'proprietary', provider: 'anthropic' };
  const envKey = model.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const source = (process.env[`OSS_${envKey}_SOURCE`] || process.env.OSS_LLM_SOURCE || 'aicore').toLowerCase();
  const provider = source === 'destination' ? 'openrouter' : 'aicore-byom';
  return { track: 'opensource', provider };
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/**
 * Normalize a (possibly partial) run configuration into a fully-resolved one.
 * - Empty/omitted predictModels  → DEFAULT_PREDICT_MODELS
 * - Empty/omitted evaluations    → DEFAULT_EVALUATIONS (filtered to the predict
 *   models actually running; falls back to pairing the default evaluators with
 *   the selected predict models when none of the defaults match)
 * - Each evaluation's inputPredictModel is resolved to a running predict model
 *   (defaults to the first predict model when missing/unknown).
 */
export function normalizeRunConfig(input?: {
  predictModels?: string[];
  evaluations?: EvaluationRunInput[];
}): RunConfig {
  let predictModels = Array.from(
    new Set((input?.predictModels ?? []).map(clean).filter(Boolean))
  );
  if (predictModels.length === 0) predictModels = [...DEFAULT_PREDICT_MODELS];

  let evaluations: EvaluationRunInput[] = (input?.evaluations ?? [])
    .map(e => ({ model: clean(e?.model), inputPredictModel: clean(e?.inputPredictModel) }))
    .filter(e => e.model);

  if (evaluations.length === 0) {
    evaluations = DEFAULT_EVALUATIONS
      .filter(e => predictModels.includes(e.inputPredictModel as string))
      .map(e => ({ ...e }));

    if (evaluations.length === 0) {
      // Custom predict set with no default match — attach the two default
      // evaluators to the available predict models so both lanes still run.
      evaluations = [
        { model: DEFAULT_PROPRIETARY_EVAL_MODEL, inputPredictModel: predictModels[0] },
        { model: DEFAULT_OPENSOURCE_EVAL_MODEL,  inputPredictModel: predictModels[1] ?? predictModels[0] }
      ];
    }
  }

  // Resolve every evaluation to a prediction that is actually running.
  evaluations = evaluations.map(e => ({
    model: e.model,
    inputPredictModel: (e.inputPredictModel && predictModels.includes(e.inputPredictModel))
      ? e.inputPredictModel
      : predictModels[0]
  }));

  return { predictModels, evaluations };
}

/** Build ModelRunConfig rows for persistence from a normalized run config. */
export function buildRunConfigRows(claimID: string, cfg: RunConfig): ModelRunConfigRecord[] {
  const rows: ModelRunConfigRecord[] = [];
  cfg.predictModels.forEach((modelName, i) => {
    rows.push({
      claim_ID: claimID,
      stage: 'predict',
      track: classifyPredictModel(modelName).track,
      modelName,
      inputPredictModel: null,
      sequence: i
    });
  });
  cfg.evaluations.forEach((e, i) => {
    rows.push({
      claim_ID: claimID,
      stage: 'evaluate',
      track: classifyEvalModel(e.model).track,
      modelName: e.model,
      inputPredictModel: e.inputPredictModel ?? null,
      sequence: i
    });
  });
  return rows;
}

/**
 * Resolve the run config for a pipeline step. Prefers the config carried in the
 * event payload; otherwise reloads it from the persisted ModelRunConfig rows;
 * falls back to defaults. This keeps queued steps self-contained yet resilient.
 */
export async function loadRunConfig(
  claimID: string,
  payload?: { predictModels?: string[]; evaluations?: EvaluationRunInput[] }
): Promise<RunConfig> {
  if ((payload?.predictModels?.length ?? 0) > 0 || (payload?.evaluations?.length ?? 0) > 0) {
    return normalizeRunConfig(payload);
  }

  try {
    const { ModelRunConfig } = cds.entities('ClaimService');
    const rows = await SELECT.from(ModelRunConfig)
      .where({ claim_ID: claimID })
      .orderBy('sequence asc') as ModelRunConfigRecord[];

    if (rows.length > 0) {
      const predictModels = rows.filter(r => r.stage === 'predict').map(r => r.modelName);
      const evaluations = rows
        .filter(r => r.stage === 'evaluate')
        .map(r => ({ model: r.modelName, inputPredictModel: r.inputPredictModel ?? undefined }));
      return normalizeRunConfig({ predictModels, evaluations });
    }
  } catch (err) {
    LOGGER.warn('Could not load persisted run config, using defaults', { claimID, reason: (err as Error).message });
  }

  return normalizeRunConfig();
}
