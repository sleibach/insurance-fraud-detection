'use strict';

// Unit tests for the custom ML FastAPI client. fetch is mocked so no live uvicorn.
const { buildMlRecord, predictWithMl, ML_API_URL } = require('../srv/code/utils/mlClient');

describe('buildMlRecord – field mapping', () => {
  test('maps camelCase field names to the PascalCase API schema', () => {
    const rec = buildMlRecord([
      { fieldName: 'make', fieldValue: 'Honda' },
      { fieldName: 'accidentArea', fieldValue: 'Urban' },
      { fieldName: 'daysPolicyAccident', fieldValue: 'more than 30' },
      { fieldName: 'basePolicy', fieldValue: 'Collision' }
    ]);
    expect(rec.Make).toBe('Honda');
    expect(rec.AccidentArea).toBe('Urban');
    expect(rec.Days_Policy_Accident).toBe('more than 30');
    expect(rec.BasePolicy).toBe('Collision');
  });

  test('coerces integer and boolean fields', () => {
    const rec = buildMlRecord([
      { fieldName: 'age', fieldValue: '34' },
      { fieldName: 'deductible', fieldValue: '400' },
      { fieldName: 'policeReportFiled', fieldValue: 'Yes' },
      { fieldName: 'witnessPresent', fieldValue: 'no' }
    ]);
    expect(rec.Age).toBe(34);
    expect(rec.Deductible).toBe(400);
    expect(rec.PoliceReportFiled).toBe(true);
    expect(rec.WitnessPresent).toBe(false);
  });

  test('fills defaults for every field and ignores unknown/blank values', () => {
    const rec = buildMlRecord([
      { fieldName: 'unknownField', fieldValue: 'x' },
      { fieldName: 'make', fieldValue: '   ' },
      { fieldName: 'age', fieldValue: 'not-a-number' }
    ]);
    expect(rec.Make).toBe('');     // blank ignored → default
    expect(rec.Age).toBe(0);       // unparseable int → 0
    expect(rec).not.toHaveProperty('unknownField');
    expect(Object.keys(rec).length).toBe(32);
  });
});

describe('predictWithMl', () => {
  const FIELDS = [{ fieldName: 'make', fieldValue: 'Honda' }];
  afterEach(() => { delete global.fetch; });

  test('parses a successful response (handles the "probabiltiy" typo)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prediction: 1, probabiltiy: 0.7321 })
    });
    const r = await predictWithMl('gbc', FIELDS);
    expect(global.fetch).toHaveBeenCalledWith(`${ML_API_URL}/predict/gbc`, expect.objectContaining({ method: 'POST' }));
    expect(r.status).toBe('success');
    expect(r.fraudScore).toBeCloseTo(0.5321, 4);
    expect(r.predictedClass).toBe('yes');
  });

  test('calibrates gbc away from clean-case false positives', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prediction: 1, probabiltiy: 0.6112 })
    });
    const r = await predictWithMl('gbc', [
      { fieldName: 'pastNumberOfClaims', fieldValue: 'none' },
      { fieldName: 'numberOfSuppliments', fieldValue: 'none' },
      { fieldName: 'policeReportFiled', fieldValue: 'Yes' },
      { fieldName: 'ageOfVehicle', fieldValue: '3 years' }
    ]);
    expect(r.fraudScore).toBeCloseTo(0.2412, 4);
    expect(r.predictedClass).toBe('no');
  });

  test('keeps gbc fraud decision for strong red flags', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prediction: 1, probabiltiy: 0.5775 })
    });
    const r = await predictWithMl('gbc', [
      { fieldName: 'pastNumberOfClaims', fieldValue: 'more than 5' },
      { fieldName: 'numberOfSuppliments', fieldValue: 'more than 5' },
      { fieldName: 'policeReportFiled', fieldValue: 'No' },
      { fieldName: 'ageOfVehicle', fieldValue: '7 years' },
      { fieldName: 'daysPolicyClaim', fieldValue: 'more than 30' }
    ]);
    expect(r.fraudScore).toBeCloseTo(0.6175, 4);
    expect(r.predictedClass).toBe('yes');
  });

  test('falls back to "probability" spelling and class no', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prediction: 0, probability: 0.2 })
    });
    const r = await predictWithMl('rf', FIELDS);
    expect(r.fraudScore).toBeCloseTo(0.2, 4);
    expect(r.predictedClass).toBe('no');
  });

  test('connectivity error → stub status with fallback score (airplane mode)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));
    const r = await predictWithMl('gbc', FIELDS, { fallbackScore: 0.33 });
    expect(r.status).toBe('stub');
    expect(r.fraudScore).toBe(0.33);
    expect(r.predictedClass).toBe('no');
  });

  test('non-OK HTTP response → failed status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'internal error'
    });
    const r = await predictWithMl('gbc', FIELDS, { fallbackScore: 0.5 });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('500');
  });
});
