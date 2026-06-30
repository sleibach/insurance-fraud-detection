const cds = require('@sap/cds');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// ─── ML FastAPI auto-start ─────────────────────────────────────────────────────
//
// The custom ML models (predict step, "custom" track) are served by the FastAPI
// app in ml/src/main.py. To keep `cds watch` a single command, we spawn uvicorn
// as a child process when the server is served and stop it on shutdown.
//
// Fully graceful + opt-out:
//   - skipped during tests (JEST_WORKER_ID / NODE_ENV=test)
//   - skipped if ML_API_AUTOSTART=false
//   - skipped (with guidance) if Python or the ML deps are missing
//   - skipped if something is already listening on the port
// When skipped, the predict step simply falls back to its ML stub.
//
// Env: ML_API_AUTOSTART (default on), ML_API_URL / ML_API_PORT (default 8000),
//      ML_PYTHON (interpreter override).

const LOGGER = cds.log('ml-serve');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ML_SRC_DIR = path.join(PROJECT_ROOT, 'ml', 'src');

let mlProcess = null;

function resolvePython() {
  const candidates = [
    process.env.ML_PYTHON,
    path.join(PROJECT_ROOT, 'ml', '.venv', 'bin', 'python'),
    path.join(PROJECT_ROOT, 'ml', 'venv', 'bin', 'python')
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'python3';
}

function getPort() {
  if (process.env.ML_API_PORT) return Number(process.env.ML_API_PORT);
  if (process.env.ML_API_URL) {
    try { return Number(new URL(process.env.ML_API_URL).port) || 8000; } catch { /* ignore */ }
  }
  return 8000;
}

function ping(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/docs', timeout: 1000 }, res => {
      res.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function depsAvailable(python) {
  const r = spawnSync(python, ['-c', 'import fastapi, uvicorn, sklearn, pandas, joblib'], { cwd: ML_SRC_DIR });
  return r.status === 0;
}

async function startMlApi() {
  if (process.env.ML_API_AUTOSTART === 'false') { LOGGER.info('ML API autostart disabled (ML_API_AUTOSTART=false)'); return; }
  if (process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === 'test') return;
  if (mlProcess) return;

  const port = getPort();
  if (await ping(port)) { LOGGER.info('ML API already running — not starting another', { port }); return; }

  if (!fs.existsSync(path.join(ML_SRC_DIR, 'main.py'))) {
    LOGGER.warn('ml/src/main.py not found — skipping ML API autostart');
    return;
  }

  const python = resolvePython();
  if (!depsAvailable(python)) {
    LOGGER.warn('Python ML dependencies not available — skipping ML API autostart (predict step will use ML stub). ' +
      'Set up once with: python3.12 -m venv ml/.venv && ml/.venv/bin/pip install -r ml/requirements.txt', { python });
    return;
  }

  LOGGER.info('Starting custom ML FastAPI (uvicorn)', { python, port, cwd: ML_SRC_DIR });
  mlProcess = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: ML_SRC_DIR,
    stdio: 'inherit',
    env: process.env
  });
  mlProcess.on('exit', (code, signal) => { LOGGER.warn('ML API process exited', { code, signal }); mlProcess = null; });
  mlProcess.on('error', err => { LOGGER.warn('Failed to start ML API', { reason: err.message }); mlProcess = null; });
}

function stopMlApi() {
  if (mlProcess) {
    LOGGER.info('Stopping ML API');
    try { mlProcess.kill('SIGTERM'); } catch { /* ignore */ }
    mlProcess = null;
  }
}

cds.on('served', () => { startMlApi().catch(err => LOGGER.warn('ML API autostart error', { reason: err.message })); });
cds.on('shutdown', stopMlApi);
process.on('exit', stopMlApi);

module.exports = cds.server;
