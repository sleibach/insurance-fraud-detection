'use strict';

/**
 * E2E Integration — Open-source evaluate track via OpenRouter (BTP destination)
 *
 * Proves the switchable third-party source: with OSS_LLM_SOURCE=destination, the
 * open-source evaluate models (gpt-oss-120b / gpt-oss-20b / gemma-3-27b) are
 * consumed from OpenRouter through the shared `openrouter-llm` BTP destination,
 * producing a real, token-counted, non-stub evaluation recorded with
 * provider='openrouter' — exactly the same pipeline/code path as AI Core BYOM,
 * only the endpoint source differs.
 *
 * Prerequisites:
 *   - hybrid binding (CF_HOME=. ; .cdsrc-private.json) with the destination
 *     service bound, and the `openrouter-llm` destination provisioned:
 *       OPENROUTER_API_KEY=sk-or-... npm run create:destination
 *   - The source switch (defaulted on here, override to skip):
 *       OSS_LLM_SOURCE=destination
 *
 * Run (all three models): CF_HOME=. npm run test:e2e -- e2e-openrouter
 * Run one model:          CF_HOME=. OSS_E2E_MODEL=gpt-oss-20b npm run test:e2e -- e2e-openrouter
 */

const fs = require('fs');
const path = require('path');

// Force the open-source track through the OpenRouter destination for this run
// (must be set before the service boots so handlers classify the lane as such).
process.env.OSS_LLM_SOURCE = process.env.OSS_LLM_SOURCE || 'destination';

const cds = require('@sap/cds');

const srv = cds.test('.', '--profile', 'hybrid');
const { GET, POST } = srv;

const demo = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/demo-cases.json'), 'utf8')
);

const ALL_MODELS = ['gpt-oss-120b', 'gpt-oss-20b', 'gemma-3-27b'];
const MODELS = process.env.OSS_E2E_MODEL ? [process.env.OSS_E2E_MODEL] : ALL_MODELS;

beforeAll(() => {
  srv.axios.defaults.auth = { username: 'alice', password: 'alice' };
});

async function pollStatus(ID, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const { data } = await GET(`/service/ClaimService/Claims(${ID})`);
    last = data.status_code;
    if (last === target) return data;
    if (last === 'failed') throw new Error(`Claim ${ID} failed: ${data.lastError}`);
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Timeout: claim ${ID} stuck at '${last}', expected '${target}'`);
}

describe('E2E: open-source evaluate via OpenRouter (BTP destination)', () => {
  // One isolated open-source lane (custom ML → OSS LLM) per model. Structure and
  // predict may stub if AI Core / the ML service are offline; the only required
  // live dependency is the OpenRouter destination for the evaluate call.
  test.each(MODELS)('%s produces a real OpenRouter evaluation (provider=openrouter)', async (model) => {
    const c = demo.cases.find(x => x.id === 'clear-fraud-1') || demo.cases[0];

    const { data: intake } = await POST('/api/intake/submitClaim', {
      externalRef: `E2E-OR-${model}-${Date.now()}`,
      rawText: c.rawText,
      predictModels: ['gbc'],
      evaluations: [{ model, inputPredictModel: 'gbc' }],
      actualFraud: c.actualFraud
    });
    expect(intake.ID).toBeTruthy();

    const claim = await pollStatus(intake.ID, 'evaluated', 180000);
    expect(claim.status_code).toBe('evaluated');

    const { data: evals } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    const oss = evals.value.find(e => e.modelName === model);
    expect(oss).toBeTruthy();

    // Routed through OpenRouter (not AI Core BYOM, not the airplane-mode stub).
    expect(oss.provider).toBe('openrouter');
    expect(oss.track).toBe('opensource');
    expect(oss.status).toBe('success');

    // Real, token-counted answer.
    expect(oss.completionTokens).toBeGreaterThan(0);
    expect(oss.totalTokens).toBeGreaterThan(0);
    expect(oss.summary).toBeTruthy();
    expect(oss.summary).not.toContain('AI Core not configured');
    expect(['low', 'medium', 'high', 'critical']).toContain(oss.riskLevel);

    // LLM-as-classifier output.
    expect(oss.fraudProbability).toBeGreaterThanOrEqual(0);
    expect(oss.fraudProbability).toBeLessThanOrEqual(1);
    expect(typeof oss.fraudDecision).toBe('boolean');
  }, 240000);
});
