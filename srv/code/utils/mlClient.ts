import cds from '@sap/cds';
import type { StructuredDataFieldRecord, RunStatus } from '../../types';

const LOGGER = cds.log('ml-client');

/** Base URL of the custom ML FastAPI (ml/src/main.py). Configurable for hybrid/CF. */
export const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';
const ML_API_TIMEOUT_MS = Number(process.env.ML_API_TIMEOUT_MS || 15000);

/**
 * Maps our camelCase StructuredDataFields.fieldName values to the PascalCase
 * field names of the FastAPI `dataRecord` model (ml/src/main.py).
 */
const FIELD_MAP: Record<string, string> = {
  month:               'Month',
  weekOfMonth:         'WeekOfMonth',
  dayOfWeek:           'DayOfWeek',
  make:                'Make',
  accidentArea:        'AccidentArea',
  dayOfWeekClaimed:    'DayOfWeekClaimed',
  monthClaimed:        'MonthClaimed',
  weekOfMonthClaimed:  'WeekOfMonthClaimed',
  sex:                 'Sex',
  maritalStatus:       'MaritalStatus',
  age:                 'Age',
  fault:               'Fault',
  policyType:          'PolicyType',
  vehicleCategory:     'VehicleCategory',
  vehiclePrice:        'VehiclePrice',
  policyNumber:        'PolicyNumber',
  repNumber:           'RepNumber',
  deductible:          'Deductible',
  driverRating:        'DriverRating',
  daysPolicyAccident:  'Days_Policy_Accident',
  daysPolicyClaim:     'Days_Policy_Claim',
  pastNumberOfClaims:  'PastNumberOfClaims',
  ageOfVehicle:        'AgeOfVehicle',
  ageOfPolicyHolder:   'AgeOfPolicyHolder',
  policeReportFiled:   'PoliceReportFiled',
  witnessPresent:      'WitnessPresent',
  agentType:           'AgentType',
  numberOfSuppliments: 'NumberOfSuppliments',
  addressChangeClaim:  'AddressChange_Claim',
  numberOfCars:        'NumberOfCars',
  year:                'Year',
  basePolicy:          'BasePolicy'
};

const INT_FIELDS  = new Set(['WeekOfMonth', 'WeekOfMonthClaimed', 'Age', 'PolicyNumber', 'RepNumber', 'Deductible', 'DriverRating', 'Year']);
const BOOL_FIELDS = new Set(['PoliceReportFiled', 'WitnessPresent']);
const GBC_BASE_CALIBRATION_OFFSET = 0.2;

/** Complete default record — pydantic requires every field to be present. */
function defaultRecord(): Record<string, unknown> {
  return {
    Month: '', WeekOfMonth: 0, DayOfWeek: '', Make: '', AccidentArea: '', DayOfWeekClaimed: '',
    MonthClaimed: '', WeekOfMonthClaimed: 0, Sex: '', MaritalStatus: '', Age: 0, Fault: '',
    PolicyType: '', VehicleCategory: '', VehiclePrice: '', PolicyNumber: 0, RepNumber: 0,
    Deductible: 0, DriverRating: 0, Days_Policy_Accident: '', Days_Policy_Claim: '',
    PastNumberOfClaims: '', AgeOfVehicle: '', AgeOfPolicyHolder: '', PoliceReportFiled: false,
    WitnessPresent: false, AgentType: '', NumberOfSuppliments: '', AddressChange_Claim: '',
    NumberOfCars: '', Year: 0, BasePolicy: ''
  };
}

/** Build a FastAPI dataRecord payload from the claim's extracted fields. */
export function buildMlRecord(fields: StructuredDataFieldRecord[]): Record<string, unknown> {
  const rec = defaultRecord();
  for (const f of fields) {
    const mlName = FIELD_MAP[f.fieldName];
    if (!mlName) continue;
    const raw = (f.fieldValue ?? '').toString().trim();
    if (raw === '') continue;
    if (INT_FIELDS.has(mlName)) {
      const n = parseInt(raw, 10);
      rec[mlName] = Number.isFinite(n) ? n : 0;
    } else if (BOOL_FIELDS.has(mlName)) {
      rec[mlName] = /^(yes|true|1)$/i.test(raw);
    } else {
      rec[mlName] = raw;
    }
  }
  return rec;
}

/** True only for errors that indicate the ML API is not reachable (airplane mode). */
function isConnectivityError(message: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|aborted|timeout|network|getaddrinfo|connect/i.test(message);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hasValue(value: unknown, pattern: RegExp): boolean {
  return pattern.test(String(value ?? ''));
}

/**
 * The GBC artifact was tuned for recall on SMOTE-balanced data, so its raw
 * probabilities are too optimistic around the decision boundary. Re-anchor the
 * score for analyst demo use and only add back strong tabular fraud signals.
 */
function calibrateGbcScore(rawScore: number, record: Record<string, unknown>, presentFields: Set<string>): number {
  let score = rawScore - GBC_BASE_CALIBRATION_OFFSET;

  if (presentFields.has('PastNumberOfClaims')) {
    if (hasValue(record.PastNumberOfClaims, /more than 5/i)) score += 0.1;
    else if (hasValue(record.PastNumberOfClaims, /2 to 4/i)) score += 0.01;
    else if (hasValue(record.PastNumberOfClaims, /none/i)) score -= 0.06;
  }

  if (presentFields.has('NumberOfSuppliments')) {
    if (hasValue(record.NumberOfSuppliments, /more than 5/i)) score += 0.1;
    else if (hasValue(record.NumberOfSuppliments, /3 to 5/i)) score += 0.02;
    else if (hasValue(record.NumberOfSuppliments, /none/i)) score -= 0.05;
  }

  if (presentFields.has('PoliceReportFiled')) {
    if (record.PoliceReportFiled === true) score -= 0.04;
    else if (record.PoliceReportFiled === false) score += 0.02;
  }

  if (presentFields.has('AgeOfVehicle')) {
    if (hasValue(record.AgeOfVehicle, /more than 7|7 years/i)) score += 0.01;
    else if (hasValue(record.AgeOfVehicle, /3 years|new|2 years/i)) score -= 0.02;
  }

  if (presentFields.has('Days_Policy_Claim') && hasValue(record.Days_Policy_Claim, /more than 30/i)) score += 0.01;

  return clampScore(score);
}

export interface MlPredictionResult {
  fraudScore: number;
  predictedClass: 'yes' | 'no';
  status: RunStatus;
  latencyMs: number;
  error?: string;
}

/**
 * Calls the custom ML FastAPI `/predict/{model}` endpoint and returns a
 * normalized prediction. Never throws — connectivity failures (airplane mode)
 * fall back to `fallbackScore` with status 'stub'; other failures use status
 * 'failed' so a single bad model never aborts the whole multi-model run.
 */
export async function predictWithMl(
  model: string,
  fields: StructuredDataFieldRecord[],
  opts: { fallbackScore?: number; baseUrl?: string; timeoutMs?: number } = {}
): Promise<MlPredictionResult> {
  const fallbackScore = opts.fallbackScore ?? 0.5;
  const baseUrl = opts.baseUrl ?? ML_API_URL;
  const timeoutMs = opts.timeoutMs ?? ML_API_TIMEOUT_MS;
  const started = Date.now();

  try {
    const record = buildMlRecord(fields);
    const presentFields = new Set(fields.map(f => FIELD_MAP[f.fieldName]).filter((name): name is string => Boolean(name)));
    const res = await fetch(`${baseUrl}/predict/${model}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ML API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json() as { prediction?: unknown; probabiltiy?: number; probability?: number };
    // Note: the FastAPI response misspells the key as "probabiltiy".
    const probRaw = json.probabiltiy ?? json.probability ?? 0.5;
    const prob = Number(probRaw);
    const rawScore = Number.isFinite(prob) ? prob : 0.5;
    const normalizedScore = model === 'gbc' ? calibrateGbcScore(rawScore, record, presentFields) : rawScore;
    const fraudScore = parseFloat(normalizedScore.toFixed(4));
    const pred = json.prediction;
    const predictedClass: 'yes' | 'no' =
      model === 'gbc'
        ? (fraudScore >= 0.5 ? 'yes' : 'no')
        : ((pred === 1 || pred === '1' || pred === true || /^(yes|fraud|true)$/i.test(String(pred))) ? 'yes' : 'no');

    LOGGER.debug('ML prediction complete', { model, fraudScore, predictedClass });
    return { fraudScore, predictedClass, status: 'success', latencyMs: Date.now() - started };

  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    const latencyMs = Date.now() - started;
    if (isConnectivityError(msg)) {
      LOGGER.warn('ML API not reachable, using stub score (airplane mode)', { model, reason: msg });
      return {
        fraudScore: fallbackScore,
        predictedClass: fallbackScore >= 0.5 ? 'yes' : 'no',
        status: 'stub',
        latencyMs
      };
    }
    LOGGER.error('ML prediction failed', { model, reason: msg });
    return {
      fraudScore: fallbackScore,
      predictedClass: fallbackScore >= 0.5 ? 'yes' : 'no',
      status: 'failed',
      latencyMs,
      error: msg
    };
  }
}
