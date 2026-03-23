import cds from '@sap/cds';
import { createChatClient } from './utils/aiClient';
import type { EvaluationResult, StructuredDataRecord, PredictionRecord } from '../types';

const LOGGER = cds.log('on-evaluateClaim');

export default async function (msg: cds.Event): Promise<void> {
  const { Claims, StructuredData, Predictions, Evaluations } = cds.entities('ClaimService');
  const { ID } = msg.data as { ID: string };

  LOGGER.info('Starting claim evaluation', { claimId: ID });

  const [claim, structuredData, prediction] = await Promise.all([
    SELECT.one.from(Claims).where({ ID }),
    SELECT.one.from(StructuredData).where({ claim_ID: ID }) as unknown as Promise<StructuredDataRecord | null>,
    SELECT.one.from(Predictions).where({ claim_ID: ID })    as unknown as Promise<PredictionRecord | null>
  ]);

  if (!prediction) throw new Error(`No Prediction for claim ${ID}. Cannot evaluate.`);

  await UPDATE(Claims).set({ status_code: 'evaluating' }).where({ ID });

  try {
    let evaluation: EvaluationResult;

    try {
      LOGGER.debug('Calling LLM for risk evaluation', { claimId: ID, fraudScore: prediction.fraudScore });

      const prompt = [
        'You are an insurance fraud analyst. Evaluate the following claim and fraud prediction.',
        '',
        `Claim Title: ${claim.title}`,
        `Claim Type: ${claim.claimType_code}`,
        `Claimed Amount: ${claim.claimAmount} ${claim.currency_code || ''}`,
        '',
        'Structured Extraction:',
        JSON.stringify(structuredData, null, 2),
        '',
        `Fraud Score: ${prediction.fraudScore} (0.0 = likely legitimate, 1.0 = likely fraud)`,
        `Model Version: ${prediction.modelVersion}`,
        '',
        'Provide a risk evaluation with summary, risk level, key contributing factors, and recommendation.'
      ].join('\n');

      const client = createChatClient('anthropic--claude-4.6-opus');
      const response = await client.run({
        messages: [
          {
            role: 'system',
            content: 'You are a senior insurance fraud analyst. ' +
              'Respond with raw JSON only — no markdown, no code blocks, no explanation. ' +
              'Required fields: summary (string), riskLevel ("low"|"medium"|"high"|"critical"), ' +
              'keyFactors (array of strings), recommendation (string).'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });
      evaluation = JSON.parse(response.getContent()) as EvaluationResult;
      LOGGER.debug('LLM evaluation complete', { claimId: ID, riskLevel: evaluation.riskLevel, keyFactorCount: evaluation.keyFactors.length });

    } catch (aiErr: unknown) {
      LOGGER.warn('AI call failed, using stub evaluation', { claimId: ID, reason: (aiErr as Error).message });
      const score = prediction.fraudScore;
      evaluation = {
        summary:        `Stub evaluation: fraud score ${score}. AI Core not configured.`,
        riskLevel:      score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low',
        keyFactors:     ['Stub mode — no AI Core connection'],
        recommendation: score >= 0.5 ? 'Escalate for manual review' : 'Approve with standard verification'
      };
    }

    await DELETE.from(Evaluations).where({ claim_ID: ID });
    await INSERT.into(Evaluations).entries({
      claim_ID:       ID,
      summary:        evaluation.summary,
      riskLevel:      evaluation.riskLevel,
      keyFactors:     JSON.stringify(evaluation.keyFactors),
      recommendation: evaluation.recommendation
    });

    await UPDATE(Claims).set({ status_code: 'evaluated', lastError: null }).where({ ID });
    LOGGER.info('Claim evaluation complete, ready for analyst review', { claimId: ID, riskLevel: evaluation.riskLevel });
    // Pipeline complete — no further event scheduled

  /* c8 ignore next 4 -- outer catch requires DB infrastructure failure */
  } catch (err: unknown) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: (err as Error).message }).where({ ID });
    throw err;
  }
};
