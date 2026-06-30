'use strict';

// Pure-function unit tests for the run-config normalizer (no DB needed).
const {
  normalizeRunConfig, classifyPredictModel, classifyEvalModel, buildRunConfigRows,
  DEFAULT_PREDICT_MODELS, DEFAULT_EVALUATIONS, ML_MODELS
} = require('../srv/code/utils/runConfig');

describe('classifyPredictModel', () => {
  test('SAP RPT models are the proprietary track', () => {
    expect(classifyPredictModel('sap-rpt-1-large')).toEqual({ track: 'proprietary', provider: 'sap-rpt' });
    expect(classifyPredictModel('sap-rpt-1-small')).toEqual({ track: 'proprietary', provider: 'sap-rpt' });
  });
  test('everything else is the custom ML track', () => {
    expect(classifyPredictModel('gbc')).toEqual({ track: 'custom', provider: 'custom-ml' });
    expect(classifyPredictModel('rf')).toEqual({ track: 'custom', provider: 'custom-ml' });
  });
});

describe('classifyEvalModel', () => {
  afterEach(() => { delete process.env.OSS_LLM_SOURCE; delete process.env.OSS_GPT_OSS_120B_SOURCE; });

  test('anthropic models are the proprietary track', () => {
    expect(classifyEvalModel('anthropic--claude-4.6-opus')).toEqual({ track: 'proprietary', provider: 'anthropic' });
  });
  test('open-source models default to the AI Core BYOM provider', () => {
    expect(classifyEvalModel('gpt-oss-120b')).toEqual({ track: 'opensource', provider: 'aicore-byom' });
    expect(classifyEvalModel('gemma-3-27b')).toEqual({ track: 'opensource', provider: 'aicore-byom' });
  });
  test('OSS_LLM_SOURCE=destination switches the open-source provider to openrouter', () => {
    process.env.OSS_LLM_SOURCE = 'destination';
    expect(classifyEvalModel('gpt-oss-120b')).toEqual({ track: 'opensource', provider: 'openrouter' });
  });
  test('per-model OSS_<MODEL>_SOURCE overrides the global switch', () => {
    process.env.OSS_GPT_OSS_120B_SOURCE = 'destination';
    expect(classifyEvalModel('gpt-oss-120b')).toEqual({ track: 'opensource', provider: 'openrouter' });
    expect(classifyEvalModel('gemma-3-27b')).toEqual({ track: 'opensource', provider: 'aicore-byom' });
  });
});

describe('normalizeRunConfig', () => {
  test('empty input → default two isolated tracks', () => {
    const cfg = normalizeRunConfig();
    expect(cfg.predictModels).toEqual(DEFAULT_PREDICT_MODELS);
    expect(cfg.evaluations).toEqual(DEFAULT_EVALUATIONS);
  });

  test('dedupes and trims predict models', () => {
    const cfg = normalizeRunConfig({ predictModels: [' gbc ', 'gbc', 'sap-rpt-1-large', ''] });
    expect(cfg.predictModels).toEqual(['gbc', 'sap-rpt-1-large']);
  });

  test('keeps explicit evaluations and resolves unknown inputPredictModel to first', () => {
    const cfg = normalizeRunConfig({
      predictModels: ['sap-rpt-1-large', 'gbc'],
      evaluations: [
        { model: 'anthropic--claude-4.6-opus', inputPredictModel: 'sap-rpt-1-large' },
        { model: 'gpt-oss-20b', inputPredictModel: 'does-not-exist' }
      ]
    });
    expect(cfg.evaluations[0].inputPredictModel).toBe('sap-rpt-1-large');
    expect(cfg.evaluations[1].inputPredictModel).toBe('sap-rpt-1-large'); // fell back to first
  });

  test('custom predict set with no default match still attaches both evaluators', () => {
    const cfg = normalizeRunConfig({ predictModels: ['rf', 'svm'] });
    expect(cfg.evaluations.length).toBe(2);
    expect(cfg.evaluations[0].inputPredictModel).toBe('rf');
    expect(cfg.evaluations[1].inputPredictModel).toBe('svm');
  });

  test('single custom predict model pairs both default evaluators to it', () => {
    const cfg = normalizeRunConfig({ predictModels: ['rf'] });
    expect(cfg.evaluations.every(e => e.inputPredictModel === 'rf')).toBe(true);
  });

  test('default evaluations filtered to the predict models actually running', () => {
    const cfg = normalizeRunConfig({ predictModels: ['sap-rpt-1-large'] });
    // Only the proprietary default evaluator is paired to sap-rpt-1-large
    expect(cfg.evaluations.some(e => e.inputPredictModel === 'sap-rpt-1-large')).toBe(true);
  });
});

describe('buildRunConfigRows', () => {
  test('emits predict rows then evaluate rows with classification + pairing', () => {
    const cfg = normalizeRunConfig();
    const rows = buildRunConfigRows('claim-1', cfg);
    const predict = rows.filter(r => r.stage === 'predict');
    const evaluate = rows.filter(r => r.stage === 'evaluate');
    expect(predict.map(r => r.modelName)).toEqual(['sap-rpt-1-large', 'gbc']);
    expect(predict.every(r => r.inputPredictModel === null)).toBe(true);
    expect(evaluate.find(r => r.track === 'opensource').inputPredictModel).toBe('gbc');
    expect(rows.every(r => r.claim_ID === 'claim-1')).toBe(true);
  });
});

describe('ML_MODELS registry', () => {
  test('contains the six classic algorithms', () => {
    ['rf', 'svm', 'lr', 'knn', 'nb', 'gbc'].forEach(m => expect(ML_MODELS.has(m)).toBe(true));
  });
});
