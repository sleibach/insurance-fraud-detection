'use strict';

/**
 * E2E Integration — Multi-Model Pipeline (Real AI Core + self-hosted BYOM LLM)
 *
 * Proves the headline capability: a single claim is processed by the
 * proprietary track (SAP RPT-1 → Claude) AND the open-source track
 * (custom ML → self-hosted open-source LLM on AI Core) in one pipeline, and
 * the self-hosted model produces a real, non-stub evaluation.
 *
 * Prerequisites:
 *   - hybrid binding (CF_HOME=. ; .cdsrc-private.json with the aicore key)
 *   - a RUNNING BYOM deployment in scenario 'aicore-opensource'
 *     (scripts/deploy-oss-model.ts). Select which model to exercise via
 *     OSS_E2E_MODEL (default 'gpt-oss-120b'; use 'gpt-oss-20b' / 'gemma-3-27b').
 *
 * Run: CF_HOME=. OSS_E2E_MODEL=gpt-oss-20b npm run test:e2e -- e2e-multimodel
 */

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');

const srv = cds.test('.', '--profile', 'hybrid');
const { GET, POST } = srv;

const demo = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/demo-cases.json'), 'utf8')
);

// Which self-hosted open-source model this run exercises (must be RUNNING).
const OSS_MODEL = process.env.OSS_E2E_MODEL || 'gpt-oss-120b';

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

describe('E2E: multi-model pipeline (proprietary + open-source BYOM)', () => {
  test(`Tathergang claim runs both tracks; ${OSS_MODEL} produces a real evaluation`, async () => {
    const c = demo.cases.find(x => x.id === 'clear-fraud-1') || demo.cases[0];

    // Default isolated tracks: RPT-1 → Claude (proprietary) and gbc → OSS LLM (open source).
    const { data: intake } = await POST('/api/intake/submitClaim', {
      externalRef: `E2E-MM-${c.id}-${Date.now()}`,
      rawText: c.rawText,
      predictModels: ['sap-rpt-1-large', 'gbc'],
      evaluations: [
        { model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' },
        { model: OSS_MODEL, inputPredictModel: 'gbc' }
      ],
      actualFraud: c.actualFraud
    });
    expect(intake.ID).toBeTruthy();

    // First call to a scale-to-zero deployment may incur a cold start.
    const claim = await pollStatus(intake.ID, 'evaluated', 240000);
    expect(claim.status_code).toBe('evaluated');

    // ─── Both prediction tracks ran ────────────────────────────────────────────
    const { data: preds } = await GET(
      `/service/ClaimService/Predictions?$filter=claim_ID eq ${intake.ID}`
    );
    const predModels = preds.value.map(p => p.modelName);
    expect(predModels).toContain('sap-rpt-1-large'); // proprietary
    expect(preds.value.length).toBeGreaterThanOrEqual(2); // + custom track

    // ─── Both evaluation tracks ran ────────────────────────────────────────────
    const { data: evals } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    expect(evals.value.length).toBeGreaterThanOrEqual(2);

    // The self-hosted open-source LLM actually answered (not the airplane-mode stub).
    const oss = evals.value.find(e => e.provider === 'aicore-byom');
    expect(oss).toBeTruthy();
    expect(oss.modelName).toBe(OSS_MODEL);
    expect(oss.status).toBe('success');
    expect(oss.completionTokens).toBeGreaterThan(0);
    expect(oss.totalTokens).toBeGreaterThan(0);
    expect(oss.summary).toBeTruthy();
    expect(oss.summary).not.toContain('AI Core not configured');
    expect(['low', 'medium', 'high', 'critical']).toContain(oss.riskLevel);
    // LLM-as-classifier produced a comparable probability/decision.
    expect(oss.fraudProbability).toBeGreaterThanOrEqual(0);
    expect(oss.fraudProbability).toBeLessThanOrEqual(1);
    expect(typeof oss.fraudDecision).toBe('boolean');

    // The proprietary track produced a real Claude evaluation too.
    const prop = evals.value.find(e => e.provider === 'anthropic');
    expect(prop).toBeTruthy();
    expect(prop.status).toBe('success');

    // ─── Isolated tracks: each evaluation consumed its paired prediction ───────
    const predById = Object.fromEntries(preds.value.map(p => [p.ID, p]));
    if (oss.basedOnPrediction_ID) {
      expect(predById[oss.basedOnPrediction_ID]?.track).toBe('custom');
    }
    if (prop.basedOnPrediction_ID) {
      expect(predById[prop.basedOnPrediction_ID]?.modelName).toBe('sap-rpt-1-large');
    }
  }, 300000);
});
