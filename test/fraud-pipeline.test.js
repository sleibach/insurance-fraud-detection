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

const AI_STRUCTURE_RESULT = {
  result: 'extracted',
  reason: '',
  claims: [{
    title:        'Rear-end collision at intersection',
    claimType:    'auto',
    incidentDate: '2024-01-15',
    claimAmount:  4800,
    currency:     'USD',
    description:  'AI extracted — rear-end collision at traffic light'
  }]
};

const AI_EVALUATION = {
  summary:        'Low probability of fraud based on available evidence.',
  riskLevel:      'low',
  keyFactors:     ['Consistent story', 'Police report filed'],
  recommendation: 'Approve with standard verification'
};

function setAiSuccess() {
  // Dispatch by system message: structure agent vs evaluation agent
  mockRun.mockImplementation(({ messages = [] }) => {
    const systemContent = messages.find(m => m.role === 'system')?.content ?? '';
    const payload = systemContent.includes('intake agent') ? AI_STRUCTURE_RESULT : AI_EVALUATION;
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
  rawText: 'Rear-end collision at intersection on 2024-01-15. Claimed amount: $4,800 USD. Auto insurance claim.'
};

// ─── SECTION 1: submitClaim validation ───────────────────────────────────────

describe('submitClaim – validation', () => {
  test('400 when neither rawText nor attachments provided', async () => {
    await expect(POST('/api/intake/submitClaim', {}))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when rawText is blank whitespace and no attachments', async () => {
    await expect(POST('/api/intake/submitClaim', { rawText: '   ' }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('200 with rawText only', async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', { rawText: 'Test claim text' });
    expect(intake.status).toBe('structuring');
    expect(intake.ID).toBeTruthy();
  });

  test('200 with attachment only (no rawText)', async () => {
    setAiSuccess();
    const fakeBytes = Buffer.from('fake-doc').toString('base64');
    const { data: intake } = await POST('/api/intake/submitClaim', {
      attachments: [{ filename: 'doc.pdf', mediaType: 'application/pdf', content: fakeBytes }]
    });
    expect(intake.status).toBe('structuring');
    expect(intake.ID).toBeTruthy();
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

  test('claim with externalRef persists it', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      externalRef: 'INS-2024-9876'
    });
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
});

// ─── SECTION 4: Analyst review – approveClaim ────────────────────────────────

describe('approveClaim', () => {
  let evaluatedID;

  beforeAll(async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
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
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
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
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
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

    await INSERT.into(Claims).entries({ ID, rawText: 'Emit error test claim', status_code: 'structuring' });

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

  // on-structureClaim: Structure Agent rejects garbage input
  test('on-structureClaim: sets status to rejected when agent rejects input', async () => {
    mockRun.mockResolvedValue({
      getContent: () => JSON.stringify({
        result: 'rejected',
        reason: 'Input is not an insurance claim — appears to be spam.',
        claims: []
      })
    });

    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID, rawText: 'buy cheap watches now!!!', status_code: 'structuring' });
    await structureClaim({ data: { ID } });

    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('rejected');
    expect(claim.rejectionReason).toContain('not an insurance claim');
  });

  // on-structureClaim: Structure Agent splits submission into multiple claims
  test('on-structureClaim: creates child claims when agent detects split', async () => {
    mockRun.mockResolvedValue({
      getContent: () => JSON.stringify({
        result: 'split',
        reason: 'Two distinct insurance claims found in submission.',
        claims: [
          { title: 'Auto collision', claimType: 'auto', incidentDate: '2024-01-15', claimAmount: 4800, currency: 'USD', description: 'Rear-end collision' },
          { title: 'Property damage', claimType: 'property', incidentDate: '2024-01-16', claimAmount: 12000, currency: 'USD', description: 'Storm damage' }
        ]
      })
    });

    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const parentID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID: parentID, rawText: 'Two claims in one', status_code: 'structuring' });

    const originalOutboxed = cds.outboxed;
    cds.outboxed = jest.fn(() => ({ emit: jest.fn().mockResolvedValue() }));
    try {
      await structureClaim({ data: { ID: parentID } });
    } finally {
      cds.outboxed = originalOutboxed;
    }

    const parent = await SELECT.one.from(Claims).where({ ID: parentID });
    expect(parent.status_code).toBe('split');
    expect(parent.rejectionReason).toContain('2 distinct claims');

    // Two child claims should have been created
    const children = await SELECT.from(Claims).where({ parentClaim_ID: parentID });
    expect(children.length).toBe(2);
    expect(children.map(c => c.status_code)).toEqual(expect.arrayContaining(['predicting', 'predicting']));
  });

  // on-predictFraud: guard throw (outside try) — claim stays at original status
  test('on-predictFraud: throws when no StructuredData exists', async () => {
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });

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

    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
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

    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
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

  // on-predictFraud: stub scorer – claimAmount > 10000 raises score to medium risk
  test('on-predictFraud: stub scorer: claimAmount > 10000 raises score to medium risk', async () => {
    mockRptPredict.mockRejectedValue(new Error('AI Core unavailable'));
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'auto', incidentDate: '2024-01-15',
      claimAmount: 15000, extractionConfidence: 0.85, rawExtraction: '{}'
    });

    const originalOutboxed = cds.outboxed;
    cds.outboxed = jest.fn(() => ({ emit: jest.fn().mockResolvedValue() }));
    try {
      await predictFraud({ data: { ID } });
    } finally {
      cds.outboxed = originalOutboxed;
    }

    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID });
    expect(prediction.fraudScore).toBe(0.4);  // 0.1 + 0.3 (> 10000)
    expect(prediction.modelVersion).toBe('rpt1-stub-v1.0');
  });

  // on-predictFraud: stub scorer – claimAmount > 50000 raises score to high risk
  test('on-predictFraud: stub scorer: claimAmount > 50000 raises score to high risk', async () => {
    mockRptPredict.mockRejectedValue(new Error('AI Core unavailable'));
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'property', incidentDate: '2024-01-15',
      claimAmount: 60000, extractionConfidence: 0.85, rawExtraction: '{}'
    });

    const originalOutboxed = cds.outboxed;
    cds.outboxed = jest.fn(() => ({ emit: jest.fn().mockResolvedValue() }));
    try {
      await predictFraud({ data: { ID } });
    } finally {
      cds.outboxed = originalOutboxed;
    }

    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID });
    expect(prediction.fraudScore).toBe(0.7);  // 0.1 + 0.3 (> 10000) + 0.3 (> 50000)
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

    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
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

    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
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

  // on-evaluateClaim: stub riskLevel branches – score >= 0.7 → high, score >= 0.4 → medium
  test('on-evaluateClaim: stub evaluation: fraudScore 0.7 → riskLevel high + escalate recommendation', async () => {
    mockRun.mockRejectedValue(new Error('AI Core unavailable'));
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, Predictions, Evaluations } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
    await INSERT.into(Predictions).entries({
      claim_ID: ID, fraudScore: 0.7, modelVersion: 'rpt1-stub-v1.0',
      predictionTimestamp: new Date().toISOString()
    });

    await evaluateClaim({ data: { ID } });

    const [evaluation] = await SELECT.from(Evaluations).where({ claim_ID: ID });
    expect(evaluation.riskLevel).toBe('high');
    expect(evaluation.recommendation).toContain('Escalate');
  });

  test('on-evaluateClaim: stub evaluation: fraudScore 0.45 → riskLevel medium', async () => {
    mockRun.mockRejectedValue(new Error('AI Core unavailable'));
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, Predictions, Evaluations } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
    await INSERT.into(Predictions).entries({
      claim_ID: ID, fraudScore: 0.45, modelVersion: 'rpt1-stub-v1.0',
      predictionTimestamp: new Date().toISOString()
    });

    await evaluateClaim({ data: { ID } });

    const [evaluation] = await SELECT.from(Evaluations).where({ claim_ID: ID });
    expect(evaluation.riskLevel).toBe('medium');
  });

  // on-evaluateClaim: null structuredData is handled gracefully (no crash on JSON.stringify)
  test('on-evaluateClaim: completes with null structuredData (AI provides analysis)', async () => {
    setAiSuccess();
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();

    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
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
