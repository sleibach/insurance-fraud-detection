import cds from '@sap/cds';
import { createChatClient, createOpenSourceChatClient } from './utils/aiClient';
import type {
  EvaluationResult, StructuredDataRecord, PredictionRecord,
  EvaluationRunInput, RunStatus, TokenUsage, ClaimRecord
} from '../types';
import { loadRunConfig, classifyEvalModel } from './utils/runConfig';

const LOGGER = cds.log('on-evaluateClaim');

/** Prompt version for minimal reproducibility (LLM-as-classifier prompt). */
const PROMPT_VERSION = 'eval-v2-classifier';

/** Strip markdown code fences that some models add despite being told not to. */
function extractJson(content: string): string {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match ? match[1].trim() : content.trim();
}

interface EvalContext {
  claim: ClaimRecord;
  structuredData: StructuredDataRecord | null;
  prediction: PredictionRecord;
}

interface EvalOutcome {
  evaluation: EvaluationResult;
  tokenUsage: TokenUsage;
  status: RunStatus;
  latencyMs: number;
}

export default async function (msg: cds.Event): Promise<void> {
  const { Claims, StructuredData, Predictions, Evaluations } = cds.entities('ClaimService');
  const { ID } = msg.data as { ID: string };

  const runConfig = await loadRunConfig(ID, msg.data as Record<string, unknown>);
  LOGGER.info('Starting claim evaluation', { claimId: ID, evaluations: runConfig.evaluations });

  const [claim, structuredData, predictions] = await Promise.all([
    SELECT.one.from(Claims).where({ ID }) as unknown as Promise<ClaimRecord>,
    SELECT.one.from(StructuredData).where({ claim_ID: ID }) as unknown as Promise<StructuredDataRecord | null>,
    SELECT.from(Predictions).where({ claim_ID: ID }) as unknown as Promise<PredictionRecord[]>
  ]);

  if (!predictions || predictions.length === 0) {
    throw new Error(`No Predictions for claim ${ID}. Cannot evaluate.`);
  }

  await UPDATE(Claims).set({ status_code: 'evaluating' }).where({ ID });

  try {
    // Index predictions by model so each evaluation consumes its paired one.
    const byModel = new Map(predictions.map(p => [p.modelName as string, p]));
    const resolvePrediction = (e: EvaluationRunInput): PredictionRecord =>
      (e.inputPredictModel && byModel.get(e.inputPredictModel)) || predictions[0];

    // Run every requested evaluation in parallel (isolated tracks).
    const outcomes = await Promise.all(
      runConfig.evaluations.map(e =>
        _runOneEvaluation(e, { claim, structuredData, prediction: resolvePrediction(e) })
      )
    );

    const rows = runConfig.evaluations.map((e, i) => {
      const cls = classifyEvalModel(e.model);
      const pred = resolvePrediction(e);
      const o = outcomes[i];
      const decision = o.evaluation.fraudDecision ?? null;
      return {
        claim_ID:             ID,
        track:                cls.track,
        provider:             cls.provider,
        modelName:            e.model,
        promptVersion:        PROMPT_VERSION,
        basedOnPrediction_ID: pred.ID ?? null,
        fraudProbability:     o.evaluation.fraudProbability ?? null,
        fraudDecision:        decision,
        decisionCriticality:  _decisionCriticality(decision, claim.actualFraud),
        summary:              o.evaluation.summary,
        riskLevel:            o.evaluation.riskLevel,
        keyFactors:           JSON.stringify(o.evaluation.keyFactors ?? []),
        recommendation:       o.evaluation.recommendation,
        promptTokens:         o.tokenUsage.promptTokens,
        completionTokens:     o.tokenUsage.completionTokens,
        totalTokens:          o.tokenUsage.totalTokens,
        status:               o.status,
        latencyMs:            o.latencyMs
      };
    });

    await DELETE.from(Evaluations).where({ claim_ID: ID });
    await INSERT.into(Evaluations).entries(rows);

    // Denormalized risk-level summaries for the List Report comparison.
    const propEval = rows.find(r => r.track === 'proprietary');
    const ossEval  = rows.find(r => r.track === 'opensource');

    await UPDATE(Claims).set({
      status_code:          'evaluated',
      lastError:            null,
      riskLevelProprietary: propEval?.riskLevel ?? null,
      riskLevelOpenSource:  ossEval?.riskLevel  ?? null
    }).where({ ID });

    LOGGER.info('Claim evaluation complete, ready for analyst review', {
      claimId: ID,
      evaluations: rows.map(r => ({ model: r.modelName, risk: r.riskLevel, status: r.status, tokens: r.totalTokens }))
    });
    // Pipeline complete — no further event scheduled

  } catch (err: unknown) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: (err as Error).message }).where({ ID });
    throw err;
  }
};

// ── Per-model evaluation ────────────────────────────────────────────────────

async function _runOneEvaluation(e: EvaluationRunInput, ctx: EvalContext): Promise<EvalOutcome> {
  const { claim, structuredData, prediction } = ctx;
  const started = Date.now();
  const { provider } = classifyEvalModel(e.model);

  try {
    LOGGER.debug('Calling evaluator LLM', { model: e.model, basedOn: prediction.modelName, fraudScore: prediction.fraudScore });

    const prompt = [
      'You are an insurance fraud analyst. Evaluate the following claim and the fraud prediction it was scored with.',
      '',
      `Claim Title: ${claim.title}`,
      `Claim Type: ${claim.claimType_code}`,
      `Claimed Amount: ${claim.claimAmount} ${claim.currency_code || ''}`,
      '',
      'Structured Extraction:',
      JSON.stringify(structuredData, null, 2),
      '',
      `Prediction Model: ${prediction.modelName} (${prediction.provider})`,
      `Fraud Score: ${prediction.fraudScore} (0.0 = likely legitimate, 1.0 = likely fraud)`,
      `Predicted Class: ${prediction.predictedClass}`,
      '',
      'Act as a calibrated classifier: reason about the claim and the prediction, then output your own',
      'fraudProbability (0.0..1.0) and a binary fraudDecision (true = fraud), plus a narrative explanation.'
    ].join('\n');

    const client = provider === 'anthropic'
      ? createChatClient(e.model)
      : createOpenSourceChatClient(e.model);

    const response = await client.run({
      messages: [
        {
          role: 'system',
          content: 'You are a senior insurance fraud analyst acting as a calibrated classifier. ' +
            'Respond with raw JSON only — no markdown, no code blocks, no explanation. ' +
            'Required fields: summary (string), riskLevel ("low"|"medium"|"high"|"critical"), ' +
            'keyFactors (array of strings), recommendation (string), ' +
            'fraudProbability (number 0..1), fraudDecision (boolean).'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const parsed = JSON.parse(extractJson(response.getContent())) as Record<string, unknown>;
    const evaluation = _normalizeEvaluation(parsed, prediction.fraudScore);
    LOGGER.debug('LLM evaluation complete', { model: e.model, riskLevel: evaluation.riskLevel });

    return {
      evaluation,
      tokenUsage: response.getTokenUsage(),
      status: 'success',
      latencyMs: Date.now() - started
    };

  } catch (aiErr: unknown) {
    LOGGER.warn('Evaluator LLM failed, using stub evaluation', { model: e.model, reason: (aiErr as Error).message });
    const score = prediction.fraudScore;
    return {
      evaluation: {
        summary:          `Stub evaluation (model ${e.model} unavailable): fraud score ${score}.`,
        riskLevel:        score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low',
        keyFactors:       ['Stub mode — evaluator model not reachable'],
        recommendation:   score >= 0.5 ? 'Escalate for manual review' : 'Approve with standard verification',
        fraudProbability: score,
        fraudDecision:    score >= 0.5
      },
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      status: 'stub',
      latencyMs: Date.now() - started
    };
  }
}

/**
 * Predicted-vs-actual criticality for the comparison table:
 *   0 = no ground-truth label, 3 = decision matches actual (green), 1 = wrong (red).
 */
function _decisionCriticality(decision: boolean | null, actual?: boolean | null): number {
  if (actual === null || actual === undefined || decision === null) return 0;
  return decision === actual ? 3 : 1;
}

/** Coerce a raw LLM JSON object into a valid EvaluationResult. */
function _normalizeEvaluation(raw: Record<string, unknown>, fraudScore: number): EvaluationResult {
  const validLevels = new Set(['low', 'medium', 'high', 'critical']);
  const riskLevel = (typeof raw.riskLevel === 'string' && validLevels.has(raw.riskLevel))
    ? raw.riskLevel as EvaluationResult['riskLevel']
    : (fraudScore >= 0.7 ? 'high' : fraudScore >= 0.4 ? 'medium' : 'low');

  const prob = typeof raw.fraudProbability === 'number' && isFinite(raw.fraudProbability)
    ? Math.max(0, Math.min(1, raw.fraudProbability))
    : fraudScore;

  const decision = typeof raw.fraudDecision === 'boolean' ? raw.fraudDecision : prob >= 0.5;

  return {
    summary:          typeof raw.summary === 'string' ? raw.summary : '',
    riskLevel,
    keyFactors:       Array.isArray(raw.keyFactors) ? raw.keyFactors.map(String) : [],
    recommendation:   typeof raw.recommendation === 'string' ? raw.recommendation : '',
    fraudProbability: parseFloat(prob.toFixed(4)),
    fraudDecision:    decision
  };
}
