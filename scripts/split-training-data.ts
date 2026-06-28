/**
 * split-training-data.ts
 *
 * One-off script: splits data/fraud_oracle.csv into three CDS seed files by
 * the "Training" split-indicator column (Training / Validation / Test).
 *
 * Output:
 *   db/data/fraud-FraudTrainingData.csv    (~10,794 rows)
 *   db/data/fraud-FraudValidationData.csv  (~2,313 rows)
 *   db/data/fraud-FraudTestData.csv        (~2,314 rows)
 *
 * Column names are mapped from the original CSV (PascalCase / underscore) to
 * the camelCase field names defined in db/schema.cds. FraudFound_P (0/1) is
 * converted to fraud ('no'/'yes'). The Training split column is dropped.
 * A sequential rowNum key is added per split (1-based).
 *
 * Run: npx ts-node scripts/split-training-data.ts
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ── Column mapping: CSV header → CDS field name ───────────────────────────────
const COLUMN_MAP: Record<string, string> = {
  Month:                  'month',
  WeekOfMonth:            'weekOfMonth',
  DayOfWeek:              'dayOfWeek',
  Make:                   'make',
  AccidentArea:           'accidentArea',
  DayOfWeekClaimed:       'dayOfWeekClaimed',
  MonthClaimed:           'monthClaimed',
  WeekOfMonthClaimed:     'weekOfMonthClaimed',
  Sex:                    'sex',
  MaritalStatus:          'maritalStatus',
  Age:                    'age',
  Fault:                  'fault',
  PolicyType:             'policyType',
  VehicleCategory:        'vehicleCategory',
  VehiclePrice:           'vehiclePrice',
  FraudFound_P:           'fraud',        // converted: 0→no, 1→yes
  PolicyNumber:           'policyNumber',
  RepNumber:              'repNumber',
  Deductible:             'deductible',
  DriverRating:           'driverRating',
  Days_Policy_Accident:   'daysPolicyAccident',
  Days_Policy_Claim:      'daysPolicyClaim',
  PastNumberOfClaims:     'pastNumberOfClaims',
  AgeOfVehicle:           'ageOfVehicle',
  AgeOfPolicyHolder:      'ageOfPolicyHolder',
  PoliceReportFiled:      'policeReportFiled',
  WitnessPresent:         'witnessPresent',
  AgentType:              'agentType',
  NumberOfSuppliments:    'numberOfSuppliments',
  AddressChange_Claim:    'addressChangeClaim',
  NumberOfCars:           'numberOfCars',
  Year:                   'year',
  BasePolicy:             'basePolicy',
  // Training column is the split key — dropped from output
};

// Output column order (matches CDS entity field order, rowNum prepended)
const OUTPUT_COLS = [
  'rowNum',
  'month', 'weekOfMonth', 'dayOfWeek', 'make', 'accidentArea',
  'dayOfWeekClaimed', 'monthClaimed', 'weekOfMonthClaimed',
  'sex', 'maritalStatus', 'age', 'fault', 'policyType',
  'vehicleCategory', 'vehiclePrice',
  'policyNumber', 'repNumber', 'deductible', 'driverRating',
  'daysPolicyAccident', 'daysPolicyClaim', 'pastNumberOfClaims',
  'ageOfVehicle', 'ageOfPolicyHolder',
  'policeReportFiled', 'witnessPresent', 'agentType',
  'numberOfSuppliments', 'addressChangeClaim', 'numberOfCars',
  'year', 'basePolicy', 'fraud',
];

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT       = path.resolve(__dirname, '..');
const INPUT_CSV  = path.join(ROOT, 'data', 'fraud_oracle.csv');
const OUTPUT_DIR = path.join(ROOT, 'db', 'data');

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result;
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function rowToCSV(values: string[]): string {
  return values.map(escapeCSV).join(',');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const counts = { Training: 0, Validation: 0, Test: 0 };

  // Open output streams
  const writers: Record<string, fs.WriteStream> = {
    Training:   fs.createWriteStream(path.join(OUTPUT_DIR, 'fraud-FraudAutoTrainingData.csv')),
    Validation: fs.createWriteStream(path.join(OUTPUT_DIR, 'fraud-FraudAutoValidationData.csv')),
    Test:       fs.createWriteStream(path.join(OUTPUT_DIR, 'fraud-FraudAutoTestData.csv')),
  };

  // Write header to each file
  const headerLine = rowToCSV(OUTPUT_COLS) + '\n';
  for (const w of Object.values(writers)) w.write(headerLine);

  // Sequential rowNum per split
  const rowNums: Record<string, number> = { Training: 0, Validation: 0, Test: 0 };

  // Stream input
  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT_CSV, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let trainingColIdx = -1;

  for await (const line of rl) {
    if (!line.trim()) continue;

    const rawFields = parseCSVLine(line);

    if (headers.length === 0) {
      // Header row: build index
      headers = rawFields;
      // Strip UTF-8 BOM from first column if present
      headers[0] = headers[0].replace(/^\uFEFF/, '');
      trainingColIdx = headers.indexOf('Training');
      if (trainingColIdx === -1) throw new Error('Training column not found in CSV');
      continue;
    }

    const split = rawFields[trainingColIdx]?.trim() as 'Training' | 'Validation' | 'Test';
    if (!writers[split]) {
      process.stderr.write(`Unknown split value "${split}" — skipping row\n`);
      continue;
    }

    // Build mapped row
    const mapped: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const csvCol   = headers[i];
      const cdsField = COLUMN_MAP[csvCol];
      if (!cdsField) continue; // Training column and any unknown columns dropped

      let value = rawFields[i]?.trim() ?? '';

      // Convert FraudFound_P: '0' → 'no', '1' → 'yes'
      if (csvCol === 'FraudFound_P') {
        value = value === '1' ? 'yes' : 'no';
      }

      mapped[cdsField] = value;
    }

    rowNums[split]++;
    mapped['rowNum'] = String(rowNums[split]);

    const outLine = rowToCSV(OUTPUT_COLS.map(col => mapped[col] ?? '')) + '\n';
    writers[split].write(outLine);
    counts[split]++;
  }

  // Close all streams
  await Promise.all(Object.values(writers).map(w => new Promise<void>((res, rej) => w.end(err => err ? rej(err) : res()))));

  console.log('Split complete:');
  console.log(`  Training:   ${counts.Training} rows  → db/data/fraud-FraudAutoTrainingData.csv`);
  console.log(`  Validation: ${counts.Validation} rows → db/data/fraud-FraudAutoValidationData.csv`);
  console.log(`  Test:       ${counts.Test} rows      → db/data/fraud-FraudAutoTestData.csv`);
}

main().catch(err => { console.error(err); process.exit(1); });
