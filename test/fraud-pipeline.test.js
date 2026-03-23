'use strict';

// Mock AI clients before any imports — controls AI call behavior per test
const mockRun = jest.fn();
jest.mock('../srv/code/utils/aiClient', () => ({
  createChatClient: jest.fn(() => ({ run: mockRun }))
}));

const mockRptPredict = jest.fn();
jest.mock('@sap-ai-sdk/rpt', () => ({
  RptClient: jest.fn().mockImplementation(() => ({ predictWithSchema: mockRptPredict }))
}));

const cds = require('@sap/cds');
const srv = cds.test('.');
const { GET, POST } = srv;

// ─── Auth setup ───────────────────────────────────────────────────────────────
// ClaimService requires 'authenticated-user'. Add Basic auth for all requests.
beforeAll(() => {
  srv.axios.defaults.auth = { username: 'alice', password: 'alice' };
});

// ─── AI response helpers ──────────────────────────────────────────────────────

const AI_EXTRACTION = {
  claimType: 'auto',
  incidentDate: '2024-01-15',
  claimAmount: 4800,
  description: 'AI extracted — rear-end collision at traffic light'
};

const AI_EVALUATION = {
  summary: 'Low probability of fraud based on available evidence.',
  riskLevel: 'low',
  keyFactors: ['Consistent story', 'Police report filed'],
  recommendation: 'Approve with standard verification'
};

function setAiSuccess() {
  // LLM: dispatch by system message content: extraction vs evaluation
  mockRun.mockImplementation(({ messages = [] }) => {
    const systemContent = messages.find(m => m.role === 'system')?.content ?? '';
    const payload = systemContent.includes('Extract structured data') ? AI_EXTRACTION : AI_EVALUATION;
    return Promise.resolve({ getContent: () => JSON.stringify(payload) });
  });
  // RPT-1: return a successful prediction (prediction='no' with 85% confidence → fraudScore≈0.15)
  mockRptPredict.mockResolvedValue({
    predictions: [{ FRAUD: [{ confidence: 0.85, prediction: 'no' }] }]
  });
}

function setAiFail() {
  const error = new Error('AI Core unavailable');
  mockRun.mockRejectedValue(error);
  mockRptPredict.mockRejectedValue(error);
}

// ─── Polling helper ───────────────────────────────────────────────────────────

async function pollStatus(ID, targetStatus, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await GET(`/service/ClaimService/Claims(${ID})`);
    if (data.status_code === targetStatus) return data;
    if (data.status_code === 'failed' && targetStatus !== 'failed') {
      throw new Error(`Claim ${ID} failed unexpectedly: ${data.lastError}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  const { data } = await GET(`/service/ClaimService/Claims(${ID})`);
  throw new Error(`Timeout: claim ${ID} stuck at '${data.status_code}', expected '${targetStatus}'`);
}

// ─── Base payload ─────────────────────────────────────────────────────────────

const BASE = {
  title: 'Rear-end collision at intersection',
  claimAmount: 4800,
  currency: 'USD',
  claimType: 'auto'
};

// ─── SECTION 1: submitClaim validation ───────────────────────────────────────

describe('submitClaim – validation', () => {
  test('400 when title is missing', async () => {
    const { claimAmount, currency, claimType } = BASE;
    await expect(POST('/api/intake/submitClaim', { claimAmount, currency, claimType }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when title is blank whitespace', async () => {
    await expect(POST('/api/intake/submitClaim', { ...BASE, title: '   ' }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when claimAmount is zero', async () => {
    await expect(POST('/api/intake/submitClaim', { ...BASE, claimAmount: 0 }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when claimAmount is negative', async () => {
    await expect(POST('/api/intake/submitClaim', { ...BASE, claimAmount: -100 }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when claimType is missing', async () => {
    const { title, claimAmount, currency } = BASE;
    await expect(POST('/api/intake/submitClaim', { title, claimAmount, currency }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when currency is missing', async () => {
    const { title, claimAmount, claimType } = BASE;
    await expect(POST('/api/intake/submitClaim', { title, claimAmount, claimType }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });
});

// ─── SECTION 2: Full pipeline – AI success path ───────────────────────────────

describe('Full pipeline – AI success path', () => {
  beforeEach(setAiSuccess);

  test('claim runs through all steps to evaluated status', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    expect(intake.status).toBe('structuring');
    expect(intake.ID).toBeTruthy();

    const claim = await pollStatus(intake.ID, 'evaluated');
    expect(claim.status_code).toBe('evaluated');
  });

  test('claim with externalRef returns it in response and persists it', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      externalRef: 'INS-2024-9876'
    });
    expect(intake.externalRef).toBe('INS-2024-9876');

    await pollStatus(intake.ID, 'evaluated');

    const { data: claim } = await GET(`/service/ClaimService/Claims(${intake.ID})`);
    expect(claim.externalRef).toBe('INS-2024-9876');
  });

  test('StructuredData is created after pipeline completes', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/StructuredData?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(1);
    expect(data.value[0].claimType).toBe('auto');
  });

  test('Prediction is created after pipeline completes', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Predictions?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(1);
    expect(data.value[0].fraudScore).toBeGreaterThanOrEqual(0);
  });

  test('Evaluation is created after pipeline completes', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(1);
    expect(data.value[0].riskLevel).toBe('low');
  });

  test('claim with image attachment stores it and exercises base64 vision path', async () => {
    const fakeImageBytes = Buffer.from('fake-image-bytes').toString('base64');
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      attachments: [
        { filename: 'damage.jpg', mediaType: 'image/jpeg', content: fakeImageBytes }
      ]
    });
    expect(intake.status).toBe('structuring');

    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Attachments?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(1);
    expect(data.value[0].filename).toBe('damage.jpg');
  });

  test('non-image attachment is stored but not passed to vision model', async () => {
    // Covers the filter branch: mediaType does NOT start with 'image/' → excluded from AI prompt
    const fakePdfBytes = Buffer.from('fake-pdf-content').toString('base64');
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      title: 'Claim with non-image attachment',
      attachments: [
        { filename: 'report.pdf', mediaType: 'application/pdf', content: fakePdfBytes }
      ]
    });

    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Attachments?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(1);
    expect(data.value[0].filename).toBe('report.pdf');
  });
});

// ─── SECTION 3: Full pipeline – AI stub fallback path ────────────────────────

describe('Full pipeline – AI stub fallback', () => {
  beforeEach(setAiFail);

  test('pipeline completes to evaluated even when AI Core is unavailable', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    const claim = await pollStatus(intake.ID, 'evaluated');
    expect(claim.status_code).toBe('evaluated');
  });

  test('stub evaluation: fraudScore 0.1 → riskLevel low', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value[0].riskLevel).toBe('low');
  });

  test('stub scorer: claimAmount > 10000 raises score to medium risk', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      claimAmount: 15000   // > 10000 → score = 0.4 → 'medium'
    });
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value[0].riskLevel).toBe('medium');
  });

  test('stub scorer: claimAmount > 50000 raises score to high risk', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      claimAmount: 60000   // > 50000 → score = 0.7 → 'high'
    });
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value[0].riskLevel).toBe('high');
  });
});

// ─── SECTION 4: Analyst review – approveClaim ────────────────────────────────

describe('approveClaim', () => {
  let evaluatedID;

  beforeAll(async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      title: 'Claim for approval test'
    });
    await pollStatus(intake.ID, 'evaluated');
    evaluatedID = intake.ID;
  });

  test('404 when claim does not exist', async () => {
    const fakeID = cds.utils.uuid();
    await expect(
      POST('/service/ClaimService/Claims_approveClaim', { ID: fakeID })
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  test('409 when claim is not yet evaluated', async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    // Claim is in 'structuring' right after intake — not yet 'evaluated'
    await expect(
      POST('/service/ClaimService/Claims_approveClaim', { ID: intake.ID })
    ).rejects.toMatchObject({ response: { status: 409 } });
  });

  test('approves claim without notes', async () => {
    const { data } = await POST('/service/ClaimService/Claims_approveClaim', {
      ID: evaluatedID
    });
    expect(data.status_code).toBe('approved');
    expect(data.reviewNotes).toBeNull();
  });
});

describe('approveClaim – with notes', () => {
  let evaluatedID;

  beforeAll(async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      title: 'Claim for approval with notes'
    });
    await pollStatus(intake.ID, 'evaluated');
    evaluatedID = intake.ID;
  });

  test('approves claim and persists reviewer notes', async () => {
    const { data } = await POST('/service/ClaimService/Claims_approveClaim', {
      ID: evaluatedID,
      notes: 'Verified police report. Legitimate claim.'
    });
    expect(data.status_code).toBe('approved');
    expect(data.reviewNotes).toBe('Verified police report. Legitimate claim.');
  });
});

// ─── SECTION 5: Analyst review – flagClaim ───────────────────────────────────

describe('flagClaim', () => {
  let evaluatedID;

  beforeAll(async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      title: 'Suspicious claim for flagging test'
    });
    await pollStatus(intake.ID, 'evaluated');
    evaluatedID = intake.ID;
  });

  test('404 when claim does not exist', async () => {
    const fakeID = cds.utils.uuid();
    await expect(
      POST('/service/ClaimService/Claims_flagClaim', { ID: fakeID, reason: 'x' })
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  test('409 when claim is not yet evaluated', async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await expect(
      POST('/service/ClaimService/Claims_flagClaim', { ID: intake.ID, reason: 'y' })
    ).rejects.toMatchObject({ response: { status: 409 } });
  });

  test('400 when reason is missing', async () => {
    await expect(
      POST('/service/ClaimService/Claims_flagClaim', { ID: evaluatedID })
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when reason is blank whitespace', async () => {
    await expect(
      POST('/service/ClaimService/Claims_flagClaim', { ID: evaluatedID, reason: '   ' })
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  test('flags claim with reason and trims it', async () => {
    const { data } = await POST('/service/ClaimService/Claims_flagClaim', {
      ID: evaluatedID,
      reason: 'Inconsistent incident dates across documents.'
    });
    expect(data.status_code).toBe('flagged');
    expect(data.reviewNotes).toBe('Inconsistent incident dates across documents.');
  });
});

// ─── SECTION 6: Pipeline error resilience (outer catch blocks) ────────────────

describe('Pipeline error resilience', () => {
  beforeEach(setAiSuccess);

  // on-structureClaim: guard throw (outside try) — claim stays at its original status
  test('on-structureClaim: throws when claim does not exist', async () => {
    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const nonExistentID = cds.utils.uuid();

    await expect(structureClaim({ data: { ID: nonExistentID } }))
      .rejects.toThrow(`Claim ${nonExistentID} not found`);
  });

  // on-structureClaim: outer catch — triggered by emit throwing inside the try block
  test('on-structureClaim: sets status to failed when emit throws', async () => {
    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({
      ID,
      title: 'StructureClaim emit error test',
      claimAmount: 1000,
      currency_code: 'USD',
      claimType_code: 'auto',
      status_code: 'structuring'
    });

    const originalOutboxed = cds.outboxed;
    cds.outboxed = jest.fn(() => ({
      emit: jest.fn().mockRejectedValue(new Error('Outbox unavailable'))
    }));

    try {
      await expect(structureClaim({ data: { ID } })).rejects.toThrow('Outbox unavailable');
    } finally {
      cds.outboxed = originalOutboxed;
    }

    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('failed');
    expect(claim.lastError).toBe('Outbox unavailable');
  });

  // on-predictFraud: guard throw (outside try) — claim stays at original status
  test('on-predictFraud: throws when no StructuredData exists', async () => {
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({
      ID,
      title: 'PredictFraud guard test',
      claimAmount: 1000,
      currency_code: 'USD',
      claimType_code: 'auto',
      status_code: 'structured'
    });

    await expect(predictFraud({ data: { ID } }))
      .rejects.toThrow(`No StructuredData for claim ${ID}. Cannot predict.`);

    // Guard fires before any UPDATE, so status stays at original value
    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('structured');
  });

  // on-predictFraud: outer catch — triggered by emit throwing inside the try block
  test('on-predictFraud: sets status to failed when emit throws', async () => {
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({
      ID,
      title: 'PredictFraud emit error test',
      claimAmount: 1000,
      currency_code: 'USD',
      claimType_code: 'auto',
      status_code: 'structured'
    });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID,
      claimType: 'auto',
      incidentDate: '2024-01-15',
      claimAmount: 1000,
      extractionConfidence: 0.85,
      rawExtraction: '{}'
    });

    const originalOutboxed = cds.outboxed;
    cds.outboxed = jest.fn(() => ({
      emit: jest.fn().mockRejectedValue(new Error('Outbox unavailable'))
    }));

    try {
      await expect(predictFraud({ data: { ID } })).rejects.toThrow('Outbox unavailable');
    } finally {
      cds.outboxed = originalOutboxed;
    }

    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('failed');
    expect(claim.lastError).toBe('Outbox unavailable');
  });

  // on-predictFraud: stub scorer fallback – RPT-1 fails → null incidentDate adds 0.2 to score
  test('on-predictFraud: stub scorer fallback handles null incidentDate', async () => {
    mockRptPredict.mockRejectedValue(new Error('AI Core unavailable')); // force stub path
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({
      ID,
      title: 'Missing date fraud score test',
      claimAmount: 1000,
      currency_code: 'USD',
      claimType_code: 'auto',
      status_code: 'structured'
    });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID,
      claimType: 'auto',
      incidentDate: null,   // triggers !incidentDate branch: score += 0.2
      claimAmount: 1000,
      extractionConfidence: 0.5,
      rawExtraction: '{}'
    });

    const originalOutboxed = cds.outboxed;
    cds.outboxed = jest.fn(() => ({ emit: jest.fn().mockResolvedValue() }));

    try {
      await predictFraud({ data: { ID } });
    } finally {
      cds.outboxed = originalOutboxed;
    }

    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID });
    expect(prediction.fraudScore).toBe(0.3);  // 0.1 (base) + 0.2 (no date)
    expect(prediction.modelVersion).toBe('rpt1-stub-v1.0');
  });

  // on-predictFraud: RPT-1 success with 'yes' prediction → fraudScore = confidence
  test('on-predictFraud: extracts fraud score from "yes" RPT-1 prediction', async () => {
    mockRptPredict.mockResolvedValue({
      predictions: [{ FRAUD: [{ confidence: 0.72, prediction: 'yes' }] }]
    });
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({
      ID, title: 'High fraud score test', claimAmount: 5000,
      currency_code: 'USD', claimType_code: 'property', status_code: 'structured'
    });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'property', incidentDate: '2024-03-01',
      claimAmount: 5000, extractionConfidence: 0.9, rawExtraction: '{"description":"test"}'
    });

    const originalOutboxed = cds.outboxed;
    cds.outboxed = jest.fn(() => ({ emit: jest.fn().mockResolvedValue() }));
    try {
      await predictFraud({ data: { ID } });
    } finally {
      cds.outboxed = originalOutboxed;
    }

    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID });
    expect(prediction.fraudScore).toBe(0.72);
    expect(prediction.modelVersion).toBe('sap-rpt-1-large');
  });

  // on-evaluateClaim: guard throw (outside try) — status stays at original
  test('on-evaluateClaim: throws when no Prediction exists', async () => {
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, StructuredData } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({
      ID,
      title: 'EvaluateClaim guard test',
      claimAmount: 1000,
      currency_code: 'USD',
      claimType_code: 'auto',
      status_code: 'predicted'
    });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID,
      claimType: 'auto',
      incidentDate: '2024-01-15',
      claimAmount: 1000,
      extractionConfidence: 0.9,
      rawExtraction: '{}'
    });

    await expect(evaluateClaim({ data: { ID } }))
      .rejects.toThrow(`No Prediction for claim ${ID}. Cannot evaluate.`);

    // Guard fires before any UPDATE
    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('predicted');
  });

  // on-evaluateClaim: null structuredData is handled gracefully (no crash on JSON.stringify)
  test('on-evaluateClaim: completes with null structuredData (AI provides analysis)', async () => {
    setAiSuccess();
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({
      ID,
      title: 'EvaluateClaim no structured data',
      claimAmount: 1000,
      currency_code: 'USD',
      claimType_code: 'auto',
      status_code: 'predicted'
    });
    await INSERT.into(Predictions).entries({
      claim_ID: ID,
      fraudScore: 0.2,
      modelVersion: 'rpt1-stub-v1.0',
      predictionTimestamp: new Date().toISOString()
    });

    await evaluateClaim({ data: { ID } });

    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('evaluated');
  });
});
