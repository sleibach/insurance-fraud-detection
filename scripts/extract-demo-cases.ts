/**
 * extract-demo-cases.ts
 *
 * Curates a small, vivid set of demo/test claims from the `Tathergang`
 * free-text narratives in ml/data/fraud_oracle_tathergaenge.csv.
 *
 * Only the `Training` split carries narratives (accepted-leakage caveat — see
 * docs/scientific-scope.md). Each selected narrative becomes the `rawText` for
 * submitClaim and its `FraudFound_P` (0/1) becomes the optional `actualFraud`
 * ground-truth label, so the UI/tests can show predicted-vs-actual per model.
 *
 * Output: test/fixtures/demo-cases.json (curated cases spanning clear-legit,
 * clear-fraud and borderline) — consumed by Jest tests and the .http demo file.
 *
 * Run: npx tsx scripts/extract-demo-cases.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(PROJECT_ROOT, 'ml', 'data', 'fraud_oracle_tathergaenge.csv');
const OUT_PATH = join(PROJECT_ROOT, 'test', 'fixtures', 'demo-cases.json');

type Category = 'clear-legit' | 'clear-fraud' | 'borderline-legit' | 'borderline-fraud';

interface DemoCase {
  id: string;
  category: Category;
  externalRef: string;
  actualFraud: boolean;
  note: string;
  rawText: string;
  features: Record<string, string>;
}

interface Row {
  cols: string[];
  narrative: string;
  fraud: boolean;
}

const HEADER_FIELDS = 35;
// Feature columns surfaced into the fixture for traceability (0-based indices).
const FEATURE_COLS: Record<string, number> = {
  Make: 3, AccidentArea: 4, Age: 10, Fault: 11, PolicyType: 12,
  VehiclePrice: 14, PoliceReportFiled: 25, WitnessPresent: 26,
  PastNumberOfClaims: 22, NumberOfSuppliments: 28, AddressChange_Claim: 29,
  AgeOfVehicle: 23, BasePolicy: 32
};

function parseCsv(): Row[] {
  const raw = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(';');
    if (parts.length < HEADER_FIELDS) continue;
    // The narrative is the last column but may itself contain ';' — rejoin the tail.
    const cols = parts.slice(0, HEADER_FIELDS - 1);
    const narrative = parts.slice(HEADER_FIELDS - 1).join(';').trim();
    if (!narrative) continue;
    rows.push({ cols, narrative, fraud: cols[15] === '1' });
  }
  return rows;
}

function featuresOf(cols: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, idx] of Object.entries(FEATURE_COLS)) out[name] = cols[idx] ?? '';
  return out;
}

const yes = (v: string) => /^yes$/i.test(v);

/** Pick the first row matching a predicate that we haven't already used. */
function pick(rows: Row[], used: Set<number>, predicate: (r: Row) => boolean): Row | undefined {
  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    if (predicate(rows[i])) { used.add(i); return rows[i]; }
  }
  return undefined;
}

function main(): void {
  const rows = parseCsv();
  const withNarrative = rows.length;
  const fraudCount = rows.filter(r => r.fraud).length;
  // Prefer vivid, self-contained narratives.
  const vivid = (r: Row) => r.narrative.length >= 300;
  const used = new Set<number>();
  const cases: DemoCase[] = [];

  const add = (r: Row | undefined, category: Category, note: string): void => {
    if (!r) return;
    const n = cases.filter(c => c.category === category).length + 1;
    cases.push({
      id: `${category}-${n}`,
      category,
      externalRef: `DEMO-${category.toUpperCase()}-${String(n).padStart(2, '0')}`,
      actualFraud: r.fraud,
      note,
      rawText: r.narrative,
      features: featuresOf(r.cols)
    });
  };

  // clear-legit: not fraud, well-documented (police report filed).
  add(pick(rows, used, r => !r.fraud && vivid(r) && yes(r.cols[25])),
    'clear-legit', 'No fraud; police report filed, straightforward incident.');
  add(pick(rows, used, r => !r.fraud && vivid(r) && yes(r.cols[25])),
    'clear-legit', 'No fraud; police report filed, plausible single-vehicle accident.');

  // clear-fraud: fraud with classic red flags (added supplements; address change).
  add(pick(rows, used, r => r.fraud && vivid(r) && r.cols[28] !== 'none'),
    'clear-fraud', 'Fraud; no police report and added supplements — multiple red flags.');
  add(pick(rows, used, r => r.fraud && vivid(r) && r.cols[29] !== 'no change'),
    'clear-fraud', 'Fraud; recent address change shortly before the claim.');

  // borderline-fraud: surface signals look benign (no supplements / no address
  // change) yet the claim is fraudulent — the hard case for a classifier.
  add(pick(rows, used, r => r.fraud && vivid(r) && r.cols[28] === 'none' && r.cols[29] === 'no change'),
    'borderline-fraud', 'Fraud despite benign-looking signals (no supplements, no address change).');

  // borderline-legit: suspicious-looking signals (supplements / address change) but legit.
  add(pick(rows, used, r => !r.fraud && vivid(r) && (r.cols[28] !== 'none' || r.cols[29] !== 'no change')),
    'borderline-legit', 'Legitimate but carries suspicious-looking signals (supplements / address change).');

  // Fallbacks so we always emit at least one of each headline category.
  if (!cases.some(c => c.category.endsWith('legit'))) add(pick(rows, used, r => !r.fraud), 'clear-legit', 'No fraud.');
  if (!cases.some(c => c.category.endsWith('fraud'))) add(pick(rows, used, r => r.fraud), 'clear-fraud', 'Fraud.');

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const payload = {
    _meta: {
      source: 'ml/data/fraud_oracle_tathergaenge.csv',
      generatedBy: 'scripts/extract-demo-cases.ts',
      note: 'Curated Tathergang narratives (Training split only). actualFraud = FraudFound_P. See docs/scientific-scope.md for the accepted-leakage caveat.',
      rowsWithNarrative: withNarrative,
      fraudRowsWithNarrative: fraudCount
    },
    cases
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${cases.length} demo cases to ${OUT_PATH} (from ${withNarrative} narrated rows, ${fraudCount} fraud).`);
  for (const c of cases) console.log(`  - ${c.id} (actualFraud=${c.actualFraud}): ${c.note}`);
}

main();
