'use strict';

// ─── Mocks (must be declared before importing the service) ────────────────────
// AI clients (proprietary Claude + open-source BYOM) both route through mockRun.
const mockRun = jest.fn();
jest.mock('../srv/code/utils/aiClient', () => ({
  createChatClient:           jest.fn(() => ({ run: mockRun })),
  createOpenSourceChatClient: jest.fn(() => ({ run: mockRun }))
}));

// RPT-1 proprietary prediction.
const mockRptPredict = jest.fn();
jest.mock('@sap-ai-sdk/rpt', () => ({
  RptClient: jest.fn().mockImplementation(() => ({ predictWithSchema: mockRptPredict }))
}));

// Custom ML FastAPI client — mocked so unit tests never hit a live uvicorn.
const mockPredictWithMl = jest.fn();
jest.mock('../srv/code/utils/mlClient', () => ({
  predictWithMl: (...args) => mockPredictWithMl(...args)
}));

const cds = require('@sap/cds');
const srv = cds.test('.');
const { GET, POST } = srv;

beforeAll(() => {
  srv.axios.defaults.auth = { username: 'alice', password: 'alice' };
});

// ─── AI response helpers ──────────────────────────────────────────────────────

const TOKENS = { promptTokens: 120, completionTokens: 64, totalTokens: 184 };

function aiResponse(payload, tokens = TOKENS) {
  return { getContent: () => JSON.stringify(payload), getTokenUsage: () => tokens };
}

const AI_STRUCTURE_RESULT = {
  result: 'extracted',
  reason: '',
  claims: [{
    title:        'Rear-end collision at intersection',
    claimType:    'auto',
    incidentDate: '2024-01-15',
    claimAmount:  4800,
    currency:     'USD',
    description:  'AI extracted — rear-end collision at traffic light',
    fields:       [{ key: 'make', value: 'Honda' }, { key: 'accidentArea', value: 'Urban' }]
  }]
};

const AI_EVALUATION = {
  summary:          'Low probability of fraud based on available evidence.',
  riskLevel:        'low',
  keyFactors:       ['Consistent story', 'Police report filed'],
  recommendation:   'Approve with standard verification',
  fraudProbability: 0.12,
  fraudDecision:    false
};

function setAiSuccess() {
  mockRun.mockImplementation(({ messages = [] }) => {
    const systemContent = messages.find(m => m.role === 'system')?.content ?? '';
    const payload = systemContent.includes('intake agent') ? AI_STRUCTURE_RESULT : AI_EVALUATION;
    return Promise.resolve(aiResponse(payload));
  });
  mockRptPredict.mockResolvedValue({
    predictions: [{ FRAUD: [{ confidence: 0.85, prediction: 'no' }] }]
  });
  mockPredictWithMl.mockResolvedValue({
    fraudScore: 0.42, predictedClass: 'no', status: 'success', latencyMs: 7
  });
}

function setAiFail() {
  // Mirror the real airplane-mode failure: the SAP AI SDK throws this when no
  // AI Core service binding is present, which the structure step recognises as
  // a connectivity error and gracefully stubs.
  const error = new Error('Could not find service credentials for AI Core.');
  mockRun.mockRejectedValue(error);
  mockRptPredict.mockRejectedValue(error);
  // ML client never throws; in airplane mode it returns a stub result.
  mockPredictWithMl.mockResolvedValue({
    fraudScore: 0.1, predictedClass: 'no', status: 'stub', latencyMs: 1
  });
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

const BASE = {
  rawText: 'Rear-end collision at intersection on 2024-01-15. Claimed amount: $4,800 USD. Auto insurance claim.'
};

// `cds.outboxed` is a configurable read-only getter, so it can't be reassigned
// directly. We shadow it with an own data property and delete it to restore.
function mockOutboxed(emitImpl) {
  Object.defineProperty(cds, 'outboxed', {
    value: jest.fn(() => ({ emit: emitImpl })),
    configurable: true,
    writable: true
  });
  return () => { delete cds.outboxed; };
}
const emitRejects = () => jest.fn().mockRejectedValue(new Error('Outbox unavailable'));
const emitResolves = () => jest.fn().mockResolvedValue();

// ─── SECTION 1: submitClaim validation (REST intake) ──────────────────────────

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

// ─── SECTION 2: Run configuration persistence (ModelRunConfig) ────────────────

describe('submitClaim – run configuration', () => {
  beforeEach(setAiSuccess);

  test('persists default two isolated tracks when no run config given', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    const { data } = await GET(
      `/service/ClaimService/ModelRunConfig?$filter=claim_ID eq ${intake.ID}&$orderby=stage,sequence`
    );
    const predict = data.value.filter(r => r.stage === 'predict').map(r => r.modelName);
    const evaluate = data.value.filter(r => r.stage === 'evaluate');
    expect(predict).toEqual(['sap-rpt-1-large', 'gbc']);
    // Isolated pairing: Claude←RPT, OSS←gbc
    expect(evaluate.find(e => e.modelName.startsWith('anthropic')).inputPredictModel).toBe('sap-rpt-1-large');
    expect(evaluate.find(e => e.track === 'opensource').inputPredictModel).toBe('gbc');
  });

  test('persists a custom run config with explicit isolated pairing', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      predictModels: ['sap-rpt-1-large', 'gbc', 'rf'],
      evaluations: [
        { model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' },
        { model: 'gpt-oss-120b', inputPredictModel: 'gbc' },
        { model: 'gemma-3-27b', inputPredictModel: 'rf' }
      ]
    });
    const { data } = await GET(
      `/service/ClaimService/ModelRunConfig?$filter=claim_ID eq ${intake.ID}`
    );
    const predict = data.value.filter(r => r.stage === 'predict').map(r => r.modelName).sort();
    expect(predict).toEqual(['gbc', 'rf', 'sap-rpt-1-large']);
    const gemma = data.value.find(r => r.modelName === 'gemma-3-27b');
    expect(gemma.track).toBe('opensource');
    expect(gemma.inputPredictModel).toBe('rf');
  });
});

// ─── SECTION 3: Full pipeline – multi-model success path ──────────────────────

describe('Full pipeline – multi-model success path', () => {
  beforeEach(setAiSuccess);

  test('claim runs through all steps to evaluated status', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    expect(intake.status).toBe('structuring');
    const claim = await pollStatus(intake.ID, 'evaluated');
    expect(claim.status_code).toBe('evaluated');
  });

  test('two predictions persisted (proprietary + custom) with summary scores', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Predictions?$filter=claim_ID eq ${intake.ID}&$orderby=track`
    );
    expect(data.value.length).toBe(2);
    const tracks = data.value.map(p => p.track).sort();
    expect(tracks).toEqual(['custom', 'proprietary']);

    const { data: claim } = await GET(`/service/ClaimService/Claims(${intake.ID})`);
    expect(claim.fraudScoreProprietary).not.toBeNull();
    expect(claim.fraudScoreCustom).not.toBeNull();
  });

  test('two evaluations persisted (proprietary + open-source) with risk summaries', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(2);
    expect(data.value.map(e => e.track).sort()).toEqual(['opensource', 'proprietary']);
    data.value.forEach(e => expect(e.riskLevel).toBe('low'));

    const { data: claim } = await GET(`/service/ClaimService/Claims(${intake.ID})`);
    expect(claim.riskLevelProprietary).toBe('low');
    expect(claim.riskLevelOpenSource).toBe('low');
  });

  test('isolated tracks: each evaluation is paired to its input prediction', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}` +
      `&$expand=basedOnPrediction($select=track,modelName)`
    );
    const prop = data.value.find(e => e.track === 'proprietary');
    const oss  = data.value.find(e => e.track === 'opensource');
    expect(prop.basedOnPrediction.modelName).toBe('sap-rpt-1-large');
    expect(prop.basedOnPrediction.track).toBe('proprietary');
    expect(oss.basedOnPrediction.track).toBe('custom');
  });

  test('token usage captured on structure and evaluations', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data: sd } = await GET(
      `/service/ClaimService/StructuredData?$filter=claim_ID eq ${intake.ID}`
    );
    expect(sd.value[0].completionTokens).toBe(TOKENS.completionTokens);
    expect(sd.value[0].totalTokens).toBe(TOKENS.totalTokens);

    const { data: ev } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    ev.value.forEach(e => {
      expect(e.completionTokens).toBe(TOKENS.completionTokens);
      expect(e.totalTokens).toBe(TOKENS.totalTokens);
    });
  });

  test('LLM-as-classifier fields (fraudProbability/fraudDecision) persisted', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    data.value.forEach(e => {
      expect(e.fraudProbability).toBeCloseTo(0.12, 4);
      expect(e.fraudDecision).toBe(false);
    });
  });

  test('decisionCriticality green when decision matches actualFraud label', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      actualFraud: false   // AI_EVALUATION decision is false → matches → criticality 3
    });
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    data.value.forEach(e => expect(e.decisionCriticality).toBe(3));
  });

  test('decisionCriticality red when decision disagrees with actualFraud label', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      actualFraud: true   // decision false vs actual true → wrong → criticality 1
    });
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`
    );
    data.value.forEach(e => expect(e.decisionCriticality).toBe(1));
  });

  test('StructuredData created with extracted claim type and fields', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/StructuredData?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(1);
    expect(data.value[0].claimType).toBe('auto');
  });

  test('externalRef persists', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', { ...BASE, externalRef: 'INS-2024-9876' });
    await pollStatus(intake.ID, 'evaluated');
    const { data: claim } = await GET(`/service/ClaimService/Claims(${intake.ID})`);
    expect(claim.externalRef).toBe('INS-2024-9876');
  });

  test('three predict models run in parallel (one Predictions row each)', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      predictModels: ['sap-rpt-1-large', 'gbc', 'rf'],
      evaluations: [{ model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' }]
    });
    await pollStatus(intake.ID, 'evaluated');

    const { data } = await GET(
      `/service/ClaimService/Predictions?$filter=claim_ID eq ${intake.ID}`
    );
    expect(data.value.length).toBe(3);
    expect(data.value.map(p => p.modelName).sort()).toEqual(['gbc', 'rf', 'sap-rpt-1-large']);
    const custom = data.value.filter(p => p.track === 'custom');
    expect(custom.length).toBe(2);
    custom.forEach(p => expect(p.provider).toBe('custom-ml'));
  });

  test('image attachment stored and exercises base64 vision path', async () => {
    const fakeImageBytes = Buffer.from('fake-image-bytes').toString('base64');
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      attachments: [{ filename: 'damage.jpg', mediaType: 'image/jpeg', content: fakeImageBytes }]
    });
    await pollStatus(intake.ID, 'evaluated');
    const { data } = await GET(`/service/ClaimService/Attachments?$filter=claim_ID eq ${intake.ID}`);
    expect(data.value[0].filename).toBe('damage.jpg');
  });

  test('non-image attachment stored but not passed to vision model', async () => {
    const fakePdfBytes = Buffer.from('fake-pdf-content').toString('base64');
    const { data: intake } = await POST('/api/intake/submitClaim', {
      ...BASE,
      attachments: [{ filename: 'report.pdf', mediaType: 'application/pdf', content: fakePdfBytes }]
    });
    await pollStatus(intake.ID, 'evaluated');
    const { data } = await GET(`/service/ClaimService/Attachments?$filter=claim_ID eq ${intake.ID}`);
    expect(data.value[0].filename).toBe('report.pdf');
  });
});

// ─── SECTION 4: Unbound submitClaim action (List Report toolbar) ──────────────

describe('ClaimService.submitClaim (unbound action)', () => {
  beforeEach(setAiSuccess);

  test('creates a claim and runs the pipeline', async () => {
    const { data } = await POST('/service/ClaimService/submitClaim', {
      externalRef: 'UI-2024-001',
      rawText: 'Analyst-submitted claim narrative for an auto rear-end collision, USD 3,000.'
    });
    expect(data.status).toBe('structuring');
    expect(data.ID).toBeTruthy();
    const claim = await pollStatus(data.ID, 'evaluated');
    expect(claim.externalRef).toBe('UI-2024-001');
  });

  test('accepts image attachments via OData action', async () => {
    const fakeImageBytes = Buffer.from('fake-image-bytes').toString('base64');
    const { data } = await POST('/service/ClaimService/submitClaim', {
      externalRef: 'UI-ATTACH-001',
      attachments: [{ filename: 'fnol.png', mediaType: 'image/png', content: fakeImageBytes }]
    });
    expect(data.status).toBe('structuring');
    await pollStatus(data.ID, 'evaluated');
    const { data: atts } = await GET(`/service/ClaimService/Attachments?$filter=claim_ID eq ${data.ID}`);
    expect(atts.value[0].filename).toBe('fnol.png');
  });

  test('400 when neither rawText nor attachments provided', async () => {
    await expect(POST('/service/ClaimService/submitClaim', { externalRef: 'x' }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });
});

// ─── SECTION 5: AI stub fallback path (airplane mode) ─────────────────────────

describe('Full pipeline – AI stub fallback', () => {
  beforeEach(setAiFail);

  test('pipeline completes to evaluated even when AI Core is unavailable', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    const claim = await pollStatus(intake.ID, 'evaluated');
    expect(claim.status_code).toBe('evaluated');
  });

  test('stub evaluations are produced for both tracks', async () => {
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');
    const { data } = await GET(`/service/ClaimService/Evaluations?$filter=claim_ID eq ${intake.ID}`);
    expect(data.value.length).toBe(2);
    data.value.forEach(e => expect(e.status).toBe('stub'));
  });
});

// ─── SECTION 6: Analyst review – approveClaim ────────────────────────────────

describe('approveClaim', () => {
  let evaluatedID;
  beforeAll(async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');
    evaluatedID = intake.ID;
  });

  test('404 when claim does not exist', async () => {
    await expect(POST('/service/ClaimService/Claims_approveClaim', { ID: cds.utils.uuid() }))
      .rejects.toMatchObject({ response: { status: 404 } });
  });

  test('409 when claim is not yet evaluated', async () => {
    // Seed a claim directly in a non-evaluated state (the async pipeline now runs
    // fast enough that a submitted claim can reach 'evaluated' before this call).
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, rawText: 'Not yet evaluated', status_code: 'structuring' });
    await expect(POST('/service/ClaimService/Claims_approveClaim', { ID }))
      .rejects.toMatchObject({ response: { status: 409 } });
  });

  test('approves claim without notes', async () => {
    const { data } = await POST('/service/ClaimService/Claims_approveClaim', { ID: evaluatedID });
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
      ID: evaluatedID, notes: 'Verified police report. Legitimate claim.'
    });
    expect(data.status_code).toBe('approved');
    expect(data.reviewNotes).toBe('Verified police report. Legitimate claim.');
  });
});

// ─── SECTION 7: Analyst review – flagClaim ───────────────────────────────────

describe('flagClaim', () => {
  let evaluatedID;
  beforeAll(async () => {
    setAiSuccess();
    const { data: intake } = await POST('/api/intake/submitClaim', BASE);
    await pollStatus(intake.ID, 'evaluated');
    evaluatedID = intake.ID;
  });

  test('404 when claim does not exist', async () => {
    await expect(POST('/service/ClaimService/Claims_flagClaim', { ID: cds.utils.uuid(), reason: 'x' }))
      .rejects.toMatchObject({ response: { status: 404 } });
  });

  test('409 when claim is not yet evaluated', async () => {
    // Seed a claim directly in a non-evaluated state (the async pipeline now runs
    // fast enough that a submitted claim can reach 'evaluated' before this call).
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, rawText: 'Not yet evaluated', status_code: 'structuring' });
    await expect(POST('/service/ClaimService/Claims_flagClaim', { ID, reason: 'y' }))
      .rejects.toMatchObject({ response: { status: 409 } });
  });

  test('400 when reason is missing', async () => {
    await expect(POST('/service/ClaimService/Claims_flagClaim', { ID: evaluatedID }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('400 when reason is blank whitespace', async () => {
    await expect(POST('/service/ClaimService/Claims_flagClaim', { ID: evaluatedID, reason: '   ' }))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  test('flags claim with reason and trims it', async () => {
    const { data } = await POST('/service/ClaimService/Claims_flagClaim', {
      ID: evaluatedID, reason: 'Inconsistent incident dates across documents.'
    });
    expect(data.status_code).toBe('flagged');
    expect(data.reviewNotes).toBe('Inconsistent incident dates across documents.');
  });
});

// ─── SECTION 8: Pipeline error resilience + per-step branches ─────────────────

describe('Pipeline error resilience', () => {
  beforeEach(setAiSuccess);

  test('on-structureClaim: throws when claim does not exist', async () => {
    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const nonExistentID = cds.utils.uuid();
    await expect(structureClaim({ data: { ID: nonExistentID } }))
      .rejects.toThrow(`Claim ${nonExistentID} not found`);
  });

  test('on-structureClaim: sets status to failed when emit throws', async () => {
    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, rawText: 'Emit error test claim', status_code: 'structuring' });

    const restoreOutboxed = mockOutboxed(emitRejects());
    try {
      await expect(structureClaim({ data: { ID } })).rejects.toThrow('Outbox unavailable');
    } finally {
      restoreOutboxed();
    }

    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('failed');
    expect(claim.lastError).toBe('Outbox unavailable');
  });

  test('on-structureClaim: rejects garbage input', async () => {
    mockRun.mockResolvedValue(aiResponse({
      result: 'rejected', reason: 'Input is not an insurance claim — appears to be spam.', claims: []
    }));
    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, rawText: 'buy cheap watches now!!!', status_code: 'structuring' });
    await structureClaim({ data: { ID } });
    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('rejected');
    expect(claim.rejectionReason).toContain('not an insurance claim');
  });

  test('on-structureClaim: creates child claims when agent detects split', async () => {
    mockRun.mockResolvedValue(aiResponse({
      result: 'split',
      reason: 'Two distinct insurance claims found in submission.',
      claims: [
        { title: 'Auto collision', claimType: 'auto', incidentDate: '2024-01-15', claimAmount: 4800, currency: 'USD', description: 'Rear-end collision', fields: [] },
        { title: 'Property damage', claimType: 'property', incidentDate: '2024-01-16', claimAmount: 12000, currency: 'USD', description: 'Storm damage', fields: [] }
      ]
    }));
    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const parentID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID: parentID, rawText: 'Two claims in one', status_code: 'structuring' });

    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await structureClaim({ data: { ID: parentID } });
    } finally {
      restoreOutboxed();
    }

    const parent = await SELECT.one.from(Claims).where({ ID: parentID });
    expect(parent.status_code).toBe('split');
    const children = await SELECT.from(Claims).where({ parentClaim_ID: parentID });
    expect(children.length).toBe(2);
    // Each child inherits the run config (ModelRunConfig rows persisted).
    const { ModelRunConfig } = cds.entities('ClaimService');
    const cfg = await SELECT.from(ModelRunConfig).where({ claim_ID: children[0].ID });
    expect(cfg.length).toBeGreaterThan(0);
  });

  test('on-predictFraud: throws when no StructuredData exists', async () => {
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await expect(predictFraud({ data: { ID } }))
      .rejects.toThrow(`No StructuredData for claim ${ID}. Cannot predict.`);
    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('structured');
  });

  test('on-predictFraud: sets status to failed when emit throws', async () => {
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'auto', incidentDate: '2024-01-15',
      claimAmount: 1000, extractionConfidence: 0.85, rawExtraction: '{}'
    });

    const restoreOutboxed = mockOutboxed(emitRejects());
    try {
      await expect(predictFraud({ data: { ID, predictModels: ['sap-rpt-1-large'] } })).rejects.toThrow('Outbox unavailable');
    } finally {
      restoreOutboxed();
    }
    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('failed');
    expect(claim.lastError).toBe('Outbox unavailable');
  });

  test('on-predictFraud: RPT-1 stub scorer fallback (null incidentDate adds 0.2)', async () => {
    mockRptPredict.mockRejectedValue(new Error('AI Core unavailable'));
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'auto', incidentDate: null,
      claimAmount: 1000, extractionConfidence: 0.5, rawExtraction: '{}'
    });

    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await predictFraud({ data: { ID, predictModels: ['sap-rpt-1-large'] } });
    } finally {
      restoreOutboxed();
    }
    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID, modelName: 'sap-rpt-1-large' });
    expect(prediction.fraudScore).toBe(0.3);   // 0.1 + 0.2 (no date)
    expect(prediction.modelVersion).toBe('rpt1-stub-v1.0');
    expect(prediction.status).toBe('stub');
  });

  test('on-predictFraud: stub scorer claimAmount > 50000 → high score', async () => {
    mockRptPredict.mockRejectedValue(new Error('AI Core unavailable'));
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'property', incidentDate: '2024-01-15',
      claimAmount: 60000, extractionConfidence: 0.85, rawExtraction: '{}'
    });
    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await predictFraud({ data: { ID, predictModels: ['sap-rpt-1-large'] } });
    } finally {
      restoreOutboxed();
    }
    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID, modelName: 'sap-rpt-1-large' });
    expect(prediction.fraudScore).toBe(0.7);   // 0.1 + 0.3 + 0.3
  });

  test('on-predictFraud: RPT-1 "yes" prediction → fraudScore = confidence', async () => {
    mockRptPredict.mockResolvedValue({ predictions: [{ FRAUD: [{ confidence: 0.72, prediction: 'yes' }] }] });
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'property', incidentDate: '2024-03-01',
      claimAmount: 5000, extractionConfidence: 0.9, rawExtraction: '{"description":"test"}'
    });
    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await predictFraud({ data: { ID, predictModels: ['sap-rpt-1-large'] } });
    } finally {
      restoreOutboxed();
    }
    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID, modelName: 'sap-rpt-1-large' });
    expect(prediction.fraudScore).toBe(0.72);
    expect(prediction.predictedClass).toBe('yes');
  });

  test('on-predictFraud: custom-ML model persists a custom-track prediction', async () => {
    mockPredictWithMl.mockResolvedValue({ fraudScore: 0.66, predictedClass: 'yes', status: 'success', latencyMs: 9 });
    const predictFraud = require('../srv/code/on-predictFraud-logic').default;
    const { Claims, StructuredData, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'structured' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'auto', incidentDate: '2024-01-15',
      claimAmount: 5000, extractionConfidence: 0.9, rawExtraction: '{}'
    });
    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await predictFraud({ data: { ID, predictModels: ['gbc'] } });
    } finally {
      restoreOutboxed();
    }
    const prediction = await SELECT.one.from(Predictions).where({ claim_ID: ID, modelName: 'gbc' });
    expect(prediction.track).toBe('custom');
    expect(prediction.provider).toBe('custom-ml');
    expect(prediction.fraudScore).toBe(0.66);
    expect(prediction.modelVersion).toBe('custom-ml/gbc');
  });

  test('on-evaluateClaim: throws when no Predictions exist', async () => {
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, StructuredData } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
    await INSERT.into(StructuredData).entries({
      claim_ID: ID, claimType: 'auto', incidentDate: '2024-01-15',
      claimAmount: 1000, extractionConfidence: 0.9, rawExtraction: '{}'
    });
    await expect(evaluateClaim({ data: { ID } }))
      .rejects.toThrow(`No Predictions for claim ${ID}. Cannot evaluate.`);
    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('predicted');
  });

  test('on-evaluateClaim: stub evaluation fraudScore 0.7 → high + escalate', async () => {
    mockRun.mockRejectedValue(new Error('AI Core unavailable'));
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, Predictions, Evaluations } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
    await INSERT.into(Predictions).entries({
      claim_ID: ID, modelName: 'sap-rpt-1-large', track: 'proprietary',
      fraudScore: 0.7, modelVersion: 'rpt1-stub-v1.0', predictionTimestamp: new Date().toISOString()
    });
    await evaluateClaim({ data: { ID, evaluations: [{ model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' }] } });
    const [evaluation] = await SELECT.from(Evaluations).where({ claim_ID: ID });
    expect(evaluation.riskLevel).toBe('high');
    expect(evaluation.recommendation).toContain('Escalate');
    expect(evaluation.status).toBe('stub');
  });

  test('on-evaluateClaim: stub evaluation fraudScore 0.45 → medium', async () => {
    mockRun.mockRejectedValue(new Error('AI Core unavailable'));
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, Predictions, Evaluations } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
    await INSERT.into(Predictions).entries({
      claim_ID: ID, modelName: 'sap-rpt-1-large', track: 'proprietary',
      fraudScore: 0.45, modelVersion: 'rpt1-stub-v1.0', predictionTimestamp: new Date().toISOString()
    });
    await evaluateClaim({ data: { ID, evaluations: [{ model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' }] } });
    const [evaluation] = await SELECT.from(Evaluations).where({ claim_ID: ID });
    expect(evaluation.riskLevel).toBe('medium');
  });

  test('on-evaluateClaim: completes with null structuredData (AI provides analysis)', async () => {
    setAiSuccess();
    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Claims, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'predicted' });
    await INSERT.into(Predictions).entries({
      claim_ID: ID, modelName: 'sap-rpt-1-large', track: 'proprietary',
      fraudScore: 0.2, modelVersion: 'rpt1-stub-v1.0', predictionTimestamp: new Date().toISOString()
    });
    await evaluateClaim({ data: { ID, evaluations: [{ model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' }] } });
    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('evaluated');
  });
});

// ─── SECTION 9: loadRunConfig – reload from persisted ModelRunConfig ───────────

describe('loadRunConfig – reload from persisted rows', () => {
  const { loadRunConfig } = require('../srv/code/utils/runConfig');

  test('reconstructs run config from ModelRunConfig when no payload is given', async () => {
    const { Claims, ModelRunConfig } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'new' });
    await INSERT.into(ModelRunConfig).entries([
      { claim_ID: ID, stage: 'predict',  track: 'proprietary', modelName: 'sap-rpt-1-large', sequence: 0 },
      { claim_ID: ID, stage: 'predict',  track: 'custom',      modelName: 'rf',              sequence: 1 },
      { claim_ID: ID, stage: 'evaluate', track: 'proprietary', modelName: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large', sequence: 0 },
      { claim_ID: ID, stage: 'evaluate', track: 'opensource',  modelName: 'gpt-oss-20b',     inputPredictModel: 'rf', sequence: 1 }
    ]);

    const cfg = await loadRunConfig(ID); // no payload → DB reload path
    expect(cfg.predictModels).toEqual(['sap-rpt-1-large', 'rf']);
    const oss = cfg.evaluations.find(e => e.model === 'gpt-oss-20b');
    expect(oss.inputPredictModel).toBe('rf');
  });

  test('falls back to defaults when neither payload nor persisted rows exist', async () => {
    const cfg = await loadRunConfig(cds.utils.uuid());
    expect(cfg.predictModels).toEqual(['sap-rpt-1-large', 'gbc']);
  });
});

// ─── SECTION 10: Normalization fallback branches (malformed model output) ─────

describe('Structure extraction – normalization of malformed model output', () => {
  // Return raw (un-stringified) content so we can exercise the code-fence path.
  function rawAi(content, tokens = TOKENS) {
    return { getContent: () => content, getTokenUsage: () => tokens };
  }

  test('applies defaults for every missing/invalid field and ignores bad fields', async () => {
    // Code-fenced JSON, every claim field missing or the wrong type.
    const fenced = '```json\n' + JSON.stringify({
      result: 'extracted',
      reason: '',
      claims: [{
        // title missing → derived from description
        claimType:    'spaceship',     // invalid → 'auto'
        incidentDate: 'not-a-date',    // invalid → today
        claimAmount:  'a lot',         // non-number → 0
        currency:     'dollars',       // invalid → 'USD'
        // description missing → falls back to rawText
        fields:       'none'           // non-array → []
      }]
    }) + '\n```';
    mockRun.mockResolvedValue(rawAi(fenced));

    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims, StructuredData } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, rawText: 'Garage fire destroyed my car last week. Need help!', status_code: 'structuring' });

    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await structureClaim({ data: { ID, predictModels: ['sap-rpt-1-large'] } });
    } finally {
      restoreOutboxed();
    }

    const claim = await SELECT.one.from(Claims).where({ ID });
    expect(claim.status_code).toBe('structured');
    expect(claim.claimType_code).toBe('auto');
    expect(claim.currency_code).toBe('USD');
    expect(claim.claimAmount).toBe(0);
    expect(claim.title).toContain('Garage fire');   // derived from description/rawText

    const sd = await SELECT.one.from(StructuredData).where({ claim_ID: ID });
    expect(sd).toBeTruthy();
  });

  test('filters invalid field entries and keeps well-formed ones', async () => {
    mockRun.mockResolvedValue(aiResponse({
      result: 'extracted',
      reason: '',
      claims: [{
        title: 'Auto claim', claimType: 'auto', incidentDate: '2024-02-02',
        claimAmount: 3000, currency: 'EUR', description: 'Side collision',
        fields: [
          { key: 'make', value: 'Toyota' },   // valid
          { key: 'accidentArea' },             // missing value → filtered
          { value: 'orphan' },                 // missing key → filtered
          'garbage'                            // not an object → filtered
        ]
      }]
    }));

    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims, StructuredData, StructuredDataFields } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, rawText: 'Side collision claim', status_code: 'structuring' });

    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await structureClaim({ data: { ID, predictModels: ['sap-rpt-1-large'] } });
    } finally {
      restoreOutboxed();
    }

    const sd = await SELECT.one.from(StructuredData).where({ claim_ID: ID });
    const fields = await SELECT.from(StructuredDataFields).where({ structuredData_ID: sd.ID });
    expect(fields.length).toBe(1);
    expect(fields[0].fieldName).toBe('make');
  });

  test('split: child claims with fields persist their StructuredDataFields', async () => {
    mockRun.mockResolvedValue(aiResponse({
      result: 'split',
      reason: 'Two claims found.',
      claims: [
        { title: 'Auto', claimType: 'auto', incidentDate: '2024-01-15', claimAmount: 4800, currency: 'USD', description: 'Collision',
          fields: [{ key: 'make', value: 'Honda' }] },
        { title: 'Property', claimType: 'property', incidentDate: '2024-01-16', claimAmount: 12000, currency: 'USD', description: 'Storm',
          fields: [{ key: 'accidentArea', value: 'Urban' }] }
      ]
    }));

    const structureClaim = require('../srv/code/on-structureClaim-logic').default;
    const { Claims, StructuredData, StructuredDataFields } = cds.entities('ClaimService');
    const parentID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID: parentID, rawText: 'Two claims', status_code: 'structuring' });

    const restoreOutboxed = mockOutboxed(emitResolves());
    try {
      await structureClaim({ data: { ID: parentID, predictModels: ['sap-rpt-1-large'] } });
    } finally {
      restoreOutboxed();
    }

    const children = await SELECT.from(Claims).where({ parentClaim_ID: parentID });
    expect(children.length).toBe(2);
    const childSd = await SELECT.from(StructuredData).where({ claim_ID: children.map(c => c.ID) });
    const allFields = await SELECT.from(StructuredDataFields).where({ structuredData_ID: childSd.map(s => s.ID) });
    expect(allFields.length).toBe(2);
  });
});

describe('Evaluation – normalization of malformed LLM output', () => {
  function rawAi(content, tokens = TOKENS) {
    return { getContent: () => content, getTokenUsage: () => tokens };
  }

  async function seed(fraudScore, actualFraud) {
    const { Claims, Predictions } = cds.entities('ClaimService');
    const ID = cds.utils.uuid();
    await INSERT.into(Claims).entries({ ID, status_code: 'predicted', actualFraud });
    await INSERT.into(Predictions).entries({
      claim_ID: ID, modelName: 'sap-rpt-1-large', track: 'proprietary',
      fraudScore, modelVersion: 'rpt1-stub-v1.0', predictionTimestamp: new Date().toISOString()
    });
    return ID;
  }

  test('invalid riskLevel/probability/decision fall back to score-derived values', async () => {
    // Code-fenced JSON with invalid riskLevel, no probability, non-boolean decision.
    const fenced = '```\n' + JSON.stringify({
      summary: 'unclear', riskLevel: 'banana', keyFactors: 'oops',
      recommendation: 42, fraudDecision: 'maybe'
    }) + '\n```';
    mockRun.mockResolvedValue(rawAi(fenced));

    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Evaluations } = cds.entities('ClaimService');
    const ID = await seed(0.8, true);   // high score → 'high', decision true

    await evaluateClaim({ data: { ID, evaluations: [{ model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' }] } });

    const [ev] = await SELECT.from(Evaluations).where({ claim_ID: ID });
    expect(ev.status).toBe('success');
    expect(ev.riskLevel).toBe('high');          // invalid → derived from 0.8
    expect(ev.fraudProbability).toBe(0.8);       // missing → fraudScore
    expect(ev.fraudDecision).toBe(true);         // non-boolean → prob >= 0.5
    expect(ev.keyFactors).toBe('[]');            // non-array → []
    expect(ev.decisionCriticality).toBe(3);      // decision matches actualFraud=true
  });

  test('decisionCriticality = 1 when the decision contradicts the ground-truth label', async () => {
    mockRun.mockResolvedValue(aiResponse({
      summary: 'looks fraudulent', riskLevel: 'high', keyFactors: ['inflated amount'],
      recommendation: 'escalate', fraudProbability: 0.9, fraudDecision: true
    }));

    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Evaluations } = cds.entities('ClaimService');
    const ID = await seed(0.9, false);   // model says fraud, truth = legitimate

    await evaluateClaim({ data: { ID, evaluations: [{ model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' }] } });

    const [ev] = await SELECT.from(Evaluations).where({ claim_ID: ID });
    expect(ev.decisionCriticality).toBe(1);
  });

  test('clamps out-of-range fraudProbability into [0,1]', async () => {
    mockRun.mockResolvedValue(aiResponse({
      summary: 's', riskLevel: 'low', keyFactors: [], recommendation: 'r',
      fraudProbability: 1.7, fraudDecision: false
    }));

    const evaluateClaim = require('../srv/code/on-evaluateClaim-logic').default;
    const { Evaluations } = cds.entities('ClaimService');
    const ID = await seed(0.3, null);   // no ground truth → criticality 0

    await evaluateClaim({ data: { ID, evaluations: [{ model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' }] } });

    const [ev] = await SELECT.from(Evaluations).where({ claim_ID: ID });
    expect(ev.fraudProbability).toBe(1);          // clamped
    expect(ev.decisionCriticality).toBe(0);       // no actualFraud label
  });
});
