'use strict';
const cds = require('@sap/cds');
const { createChatClient } = require('./utils/aiClient');
const LOGGER = cds.log('on-evaluateClaim');

const EVALUATION_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'claim_evaluation',
    description: 'Risk evaluation and recommendation for an insurance claim',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        summary:        { type: 'string' },
        riskLevel:      { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        keyFactors:     { type: 'array', items: { type: 'string' } },
        recommendation: { type: 'string' }
      },
      required: ['summary', 'riskLevel', 'keyFactors', 'recommendation'],
      additionalProperties: false
    }
  }
};

module.exports = async function (msg) {
  const { Claims, StructuredData, Predictions, Evaluations } = cds.entities('ClaimService');
  const { ID } = msg.data;

  LOGGER.info('Starting claim evaluation', { claimId: ID });

  const [claim, structuredData, prediction] = await Promise.all([
    SELECT.one.from(Claims).where({ ID }),
    SELECT.one.from(StructuredData).where({ claim_ID: ID }),
    SELECT.one.from(Predictions).where({ claim_ID: ID })
  ]);

  if (!prediction) throw new Error(`No Prediction for claim ${ID}. Cannot evaluate.`);

  await UPDATE(Claims).set({ status_code: 'evaluating' }).where({ ID });

  try {
    let evaluation;

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

      const client = createChatClient('gpt-4o');
      const response = await client.run({
        messages: [
          { role: 'system', content: 'You are a senior insurance fraud analyst.' },
          { role: 'user',   content: prompt }
        ],
        response_format: EVALUATION_SCHEMA,
        temperature: 0.3,
        max_tokens: 2000
      });
      evaluation = JSON.parse(response.getContent());
      LOGGER.debug('LLM evaluation complete', { claimId: ID, riskLevel: evaluation.riskLevel, keyFactorCount: evaluation.keyFactors.length });

    } catch (aiErr) {
      LOGGER.warn('AI call failed, using stub evaluation', { claimId: ID, reason: aiErr.message });
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

  } catch (err) {
    LOGGER.error('Pipeline step failed', err, { claimId: ID });
    await UPDATE(Claims).set({ status_code: 'failed', lastError: err.message }).where({ ID });
    throw err;
  }
};
