/**
 * Provision the shared BTP destination that fronts OpenRouter for the
 * open-source evaluator models (gpt-oss-120b/20b, gemma-3-27b).
 *
 * The pipeline reaches it when OSS_LLM_SOURCE=destination (see
 * srv/code/utils/llmDestination.ts). The OpenRouter API key is carried as a
 * forwarded header via the `URL.headers.Authorization` additional property, so
 * the SAP Cloud SDK injects `Authorization: Bearer <key>` on every call.
 *
 * Usage (requires the destination service binding — hybrid profile):
 *   OPENROUTER_API_KEY=sk-or-... \
 *     CF_HOME=. npx cds bind --exec --profile hybrid -- npx tsx scripts/create-destination.ts
 *
 * Idempotent: creates the destination, or updates it if it already exists, then
 * reads it back to confirm.
 */

const DESTINATION_NAME = process.env.OSS_LLM_DESTINATION || 'openrouter-llm';
const OPENROUTER_URL   = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

interface DestCreds { uri: string; url: string; clientid: string; clientsecret: string; }

/** Locate the bound destination-service credentials from VCAP_SERVICES. */
function readDestinationCreds(): DestCreds {
  const raw = process.env.VCAP_SERVICES;
  if (!raw) throw new Error('VCAP_SERVICES not set — run under `cds bind --exec --profile hybrid`.');
  const vcap = JSON.parse(raw) as Record<string, Array<{ label?: string; tags?: string[]; credentials?: any }>>;

  const all = Object.entries(vcap).flatMap(([label, arr]) =>
    (arr || []).map(s => ({ label: s.label || label, tags: s.tags || [], credentials: s.credentials || {} }))
  );
  const dest = all.find(s =>
    s.label === 'destination' ||
    s.tags.includes('destination') ||
    typeof s.credentials?.uri === 'string' && s.credentials.uri.includes('destination-configuration')
  );
  if (!dest) throw new Error('No destination service found in VCAP_SERVICES (is the `destinations` instance bound?).');

  const c = dest.credentials;
  if (!c.uri || !c.url || !c.clientid || !c.clientsecret) {
    throw new Error('Destination service credentials incomplete (need uri, url, clientid, clientsecret).');
  }
  return { uri: c.uri, url: c.url, clientid: c.clientid, clientsecret: c.clientsecret };
}

async function getToken(creds: DestCreds): Promise<string> {
  const basic = Buffer.from(`${creds.clientid}:${creds.clientsecret}`).toString('base64');
  const res = await fetch(`${creds.url.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Set OPENROUTER_API_KEY to the OpenRouter API key (sk-or-...).');
    process.exit(1);
  }

  const creds = readDestinationCreds();
  const token = await getToken(creds);
  const apiBase = `${creds.uri.replace(/\/$/, '')}/destination-configuration/v1/subaccountDestinations`;
  const authHeader = { Authorization: `Bearer ${token}` };

  // Flat destination configuration; additional properties (incl. URL.headers.*)
  // are top-level keys per the Destination Service API.
  const destination = {
    Name: DESTINATION_NAME,
    Type: 'HTTP',
    URL: OPENROUTER_URL,
    ProxyType: 'Internet',
    Authentication: 'NoAuthentication',
    Description: 'OpenRouter OpenAI-compatible endpoint for open-source fraud-eval LLMs',
    'URL.headers.Authorization': `Bearer ${apiKey}`,
    'URL.headers.Content-Type': 'application/json',
    HTML5_DefaultTimeout: '120000'
  };

  // Create (POST); if it already exists (409), update (PUT).
  let res = await fetch(apiBase, {
    method: 'POST',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify(destination)
  });

  if (res.status === 409) {
    console.log(`Destination "${DESTINATION_NAME}" exists — updating.`);
    res = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify(destination)
    });
  }

  if (!res.ok) throw new Error(`Destination create/update failed: ${res.status} ${await res.text()}`);
  console.log(`✅ Destination "${DESTINATION_NAME}" → ${OPENROUTER_URL} (status ${res.status}).`);

  // Read back to confirm (key value is masked in the response).
  const check = await fetch(`${apiBase}/${DESTINATION_NAME}`, { headers: authHeader });
  if (check.ok) {
    const body = (await check.json()) as Record<string, unknown>;
    console.log('   Confirmed:', JSON.stringify({ Name: body.Name, URL: body.URL, Authentication: body.Authentication }));
  }

  console.log('\nNext: run the pipeline / E2E with OSS_LLM_SOURCE=destination.');
}

main().catch(err => { console.error('create-destination failed:', err.message); process.exit(1); });
