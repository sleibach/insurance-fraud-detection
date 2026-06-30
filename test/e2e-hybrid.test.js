'use strict';

/**
 * E2E Integration Tests — Proprietary Track, Hybrid Mode (Real AI Core)
 *
 * Exercises the proprietary pipeline end-to-end against live SAP AI Core:
 *   Claude (structure) → SAP RPT-1 (predict) → Claude (evaluate).
 * This track needs no GPU node and no local ML server, so it runs today even
 * while the open-source BYOM deployments wait for GPU capacity. The
 * proprietary + open-source comparison in one pipeline is covered by
 * test/e2e-multimodel.test.js (requires a RUNNING BYOM deployment).
 *
 * Prerequisites:
 *   - hybrid binding (CF_HOME=. ; .cdsrc-private.json with the aicore key)
 *   - RUNNING foundation deployments: sap-rpt-1-large, anthropic--claude-4.6-opus
 *
 * Notes on assertions:
 *   - Only AUTO claims are used: RPT-1 prediction is backed by
 *     FraudAutoTrainingData; other claim types have no training entity.
 *   - We assert outputs are real (non-stub) and well-formed, NOT specific
 *     score thresholds — the real RPT-1 model is not a fixed heuristic.
 *
 * Run: CF_HOME=. npm run test:e2e -- e2e-hybrid
 */

const cds = require('@sap/cds');
const srv = cds.test('.', '--profile', 'hybrid');
const { GET, POST } = srv;

// Proprietary isolated track only: RPT-1 → Claude.
const PROP_PREDICT = 'sap-rpt-1-large';
const PROP_EVAL = 'anthropic--claude-4.6-opus';
const PROP_TRACK = {
  predictModels: [PROP_PREDICT],
  evaluations: [{ model: PROP_EVAL, inputPredictModel: PROP_PREDICT }]
};

beforeAll(() => {
  srv.axios.defaults.auth = { username: 'alice', password: 'alice' };
});

async function pollStatus(ID, targetStatus, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await GET(`/service/ClaimService/Claims(${ID})`);
    if (data.status_code === targetStatus) return data;
    if (data.status_code === 'failed') {
      throw new Error(`Claim ${ID} failed: ${data.lastError}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  const { data } = await GET(`/service/ClaimService/Claims(${ID})`);
  throw new Error(`Timeout: claim ${ID} stuck at '${data.status_code}', expected '${targetStatus}'`);
}

describe('E2E: proprietary AI pipeline (hybrid mode)', () => {
  test('auto claim runs through full pipeline with real, token-counted AI responses', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      externalRef: `E2E-AUTO-${Date.now()}`,
      rawText:
        'On March 3, 2026 my vehicle was rear-ended at a red light on Main Street. ' +
        'The police were called and a report was filed on scene; the other driver admitted fault. ' +
        'A workshop estimate of about 4,800 USD for bumper and chassis repair is attached. ' +
        'Vehicle is a 2019 Toyota sedan, comprehensive policy, no prior claims.',
      ...PROP_TRACK
    });

    expect(intake.status).toBe('structuring');
    expect(intake.ID).toBeTruthy();

    const claim = await pollStatus(intake.ID, 'evaluated', 90000);
    expect(claim.status_code).toBe('evaluated');

    // ─── Structure agent produced real (non-stub), token-counted extraction ──────
    const { data: sdResult } = await GET(
      `/service/ClaimService/StructuredData?$filter=claim_ID eq ${intake.ID}`
    );
    expect(sdResult.value.length).toBe(1);
    const sd = sdResult.value[0];
    expect(sd.claimType).toBeTruthy();
    const raw = JSON.parse(sd.rawExtraction);
    expect(raw.description).not.toContain('Stub extraction');
    expect(sd.totalTokens).toBeGreaterThan(0); // output-token counting

    // ─── SAP RPT-1 produced a real prediction ────────────────────────────────────
    const { data: predResult } = await GET(
      `/service/ClaimService/Predictions?$filter=claim_ID eq ${intake.ID}`
    );
    const pred = predResult.value.find(p => p.modelName === PROP_PREDICT);
    expect(pred).toBeTruthy();
    expect(pred.provider).toBe('sap-rpt');
    expect(pred.track).toBe('proprietary');
    expect(pred.status).toBe('success');
    expect(pred.fraudScore).toBeGreaterThanOrEqual(0);
    expect(pred.fraudScore).toBeLessThanOrEqual(1);

    // ─── Claude produced a real, token-counted evaluation of that prediction ─────
    const { data: evalResult } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    const ev = evalResult.value.find(e => e.provider === 'anthropic');
    expect(ev).toBeTruthy();
    expect(ev.modelName).toBe(PROP_EVAL);
    expect(ev.status).toBe('success');
    expect(['low', 'medium', 'high', 'critical']).toContain(ev.riskLevel);
    expect(ev.summary).toBeTruthy();
    expect(ev.summary).not.toContain('AI Core not configured');
    expect(ev.recommendation).toBeTruthy();
    expect(ev.totalTokens).toBeGreaterThan(0); // output-token counting

    // Isolated track: the evaluation reasoned about the RPT-1 prediction.
    if (ev.basedOnPrediction_ID) {
      expect(ev.basedOnPrediction_ID).toBe(pred.ID);
    }
  }, 120000);

  test('labeled fraud auto claim yields LLM-as-classifier decision compared to ground truth', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      externalRef: `E2E-LABELED-${Date.now()}`,
      rawText:
        'Single-vehicle accident reported on February 18, 2026, three days after the policy was upgraded. ' +
        'No police report, no witnesses. The claimed write-off value far exceeds the listed vehicle price, ' +
        'the address was changed the week of the claim, and there are multiple prior claims on the policy.',
      actualFraud: true,
      ...PROP_TRACK
    });

    const claim = await pollStatus(intake.ID, 'evaluated', 90000);
    expect(claim.status_code).toBe('evaluated');

    const { data: evalResult } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    const ev = evalResult.value.find(e => e.provider === 'anthropic');
    expect(ev).toBeTruthy();
    // LLM-as-classifier output is well-formed and comparable to the label.
    expect(typeof ev.fraudDecision).toBe('boolean');
    expect(ev.fraudProbability).toBeGreaterThanOrEqual(0);
    expect(ev.fraudProbability).toBeLessThanOrEqual(1);
    // decisionCriticality: 3 = correct, 1 = wrong, 0 = no label. A label was set.
    expect([1, 3]).toContain(ev.decisionCriticality);
  }, 120000);

  test('analyst can approve an evaluated claim', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      externalRef: `E2E-APPROVE-${Date.now()}`,
      rawText:
        'Low-speed parking lot collision on January 12, 2026. Cosmetic damage to the front bumper only. ' +
        'Both parties exchanged details and a workshop estimate of 1,200 USD is attached.',
      ...PROP_TRACK
    });

    await pollStatus(intake.ID, 'evaluated', 90000);

    const { data } = await POST('/service/ClaimService/Claims_approveClaim', {
      ID: intake.ID,
      notes: 'E2E verified — low risk, consistent documentation. Approved.'
    });

    expect(data.status_code).toBe('approved');
    expect(data.reviewNotes).toContain('E2E verified');
  }, 120000);

  test('analyst can flag a suspicious claim', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      externalRef: `E2E-FLAG-${Date.now()}`,
      rawText:
        'Total-loss auto claim filed on December 20, 2025, two days before policy expiry. ' +
        'No police report and no witnesses. This is the third claim in 12 months on the same policy.',
      ...PROP_TRACK
    });

    await pollStatus(intake.ID, 'evaluated', 90000);

    const { data } = await POST('/service/ClaimService/Claims_flagClaim', {
      ID: intake.ID,
      reason: 'E2E verified — third claim in 12 months, no supporting documentation. Escalate for investigation.'
    });

    expect(data.status_code).toBe('flagged');
    expect(data.reviewNotes).toContain('E2E verified');
  }, 120000);
});
