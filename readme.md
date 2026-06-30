# Insurance Fraud Detection

An autonomous B2C insurance claim fraud detection system built on SAP Cloud Application Programming Model (CAP). Claims are ingested via integration APIs, processed through a multi-stage AI pipeline, and surfaced to fraud analysts via a Fiori Elements monitoring UI.

## Architecture

```
                            Autonomous Pipeline (CAP Transactional Event Queues)

 External Systems         tx1              tx2                tx3                  tx4
 ┌────────────┐     ┌───────────┐   ┌───────────┐   ┌────────────────┐   ┌────────────────┐
 │ Insurer    │────>│  Intake   │──>│ Structure │──>│    Predict     │──>│    Evaluate    │
 │ Portal /   │     │  (REST)   │   │  Agent    │   │  (multi-model) │   │  (multi-model) │
 │ Email / API│     └───────────┘   └───────────┘   └────────────────┘   └────────────────┘
 └────────────┘      ClaimIntake     Claude 4.6       ┌──────┬──────┐     ┌──────┬──────┐
                      Service        Vision+LLM       │RPT-1 │Custom│     │Claude│ gpt- │
                                                      │(SAP) │ML gbc│     │ 4.6  │ oss  │
                                                      └──────┴──────┘     └──────┴──────┘
                                                       SAP AI   Self-      SAP AI  Self-
                                                       Core    trained     Core   hosted
                                                      (proprietary │ custom)(proprietary │ open-source)
                                                       └─ isolated tracks: each eval ← one prediction ─┘

                            Fiori Elements (Internal Monitoring + Review)
                     ┌──────────────────────────────────────────────────────┐
                     │  List Report: claims, status, fraud scores           │
                     │  Object Page: details, evidence, model comparison    │
                     └──────────────────────────────────────────────────────┘
```

### Pipeline Steps

| Step | Purpose | Technology |
|------|---------|------------|
| **Intake** | Receive claims + attachments via REST API | CAP `@protocol: 'rest'` service |
| **Structure** | Extract structured fields from documents using LLM vision | `@sap-ai-sdk/orchestration` / `anthropic--claude-4.6-opus` |
| **Predict** | Classify fraud probability from tabular features | Multi-model -- see below |
| **Evaluate** | Generate human-readable risk assessment and recommendation | Multi-model -- see below |
| **Review** | Analyst compares model results and approves or flags claim | SAP Fiori Elements (annotation-driven) |

Steps 1-4 execute autonomously as chained CAP transactional event queues. Step 5 is the single human interaction point.

### Multi-Model Execution (TX3 + TX4)

The Predict and Evaluate steps run in **multi-model mode**: each claim is processed by multiple models in parallel, in **isolated tracks**, so a proprietary and an open-source lane can be compared side by side. Which models run is chosen per claim via a **run configuration** (defaults to the two tracks below).

| Step | Proprietary track | Open-source / custom track | Purpose |
|------|-------------------|----------------------------|---------|
| **Predict** | SAP RPT-1 (`@sap-ai-sdk/rpt` / `sap-rpt-1-large`) | Self-trained scikit-learn classifier (`gbc` gradient boosting default; also `rf`/`svm`/`lr`/`knn`/`nb`) via FastAPI | Compare a managed foundation model against a domain-specific model trained on historical claim data |
| **Evaluate** | Claude 4.6 (`@sap-ai-sdk/orchestration` / `anthropic--claude-4.6-opus`) | Self-hosted open LLM on AI Core (BYOM): `gpt-oss-120b` default, `gpt-oss-20b`, `gemma-3-27b` | Compare a managed commercial LLM against an open-source LLM under full operational control |

**Isolated tracks**: each evaluation reasons over exactly one prediction (Claude ← RPT-1, open-source LLM ← custom ML). Every prediction/evaluation is stored per claim with its `track`, `status`, latency, and (for LLMs) **output-token** count, and surfaced in the Fiori Object Page comparison tables — including predicted-vs-actual coloring for labeled demo cases.

See [docs/ai/fraud-detection-pipeline.md](docs/ai/fraud-detection-pipeline.md) for the full entity model and [docs/scientific-scope.md](docs/scientific-scope.md) for what the comparison does and does not claim.

### Design Principles

- **Airplane mode** -- the application runs fully locally via `cds watch` without any remote services. All external dependencies (AI Core, HANA, auth) are stubbed or mocked in development. Hybrid mode (`--profile hybrid`) enables integration testing against real services.
- **Event-driven processing** -- each pipeline step runs in its own transaction via `cds.outboxed()`, ensuring fault isolation, independent retries, and observable queue state.
- **Annotation-driven UI** -- the Fiori Elements frontend is generated entirely from CDS annotations. No custom UI code.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | SAP CAP (Node.js, `@sap/cds` 8.x) |
| Database | SQLite (dev) / SAP HANA Cloud (prod) |
| Auth | Mocked (dev) / XSUAA (prod) |
| LLM (managed) | Claude 4.6 via SAP AI Core (`@sap-ai-sdk/orchestration`) |
| LLM (self-hosted, BYOM) | gpt-oss-120b / gpt-oss-20b / gemma-3-27b on SAP AI Core via vLLM (`@sap-ai-sdk/ai-api`) |
| Prediction (managed) | SAP RPT-1 via SAP AI Core (`@sap-ai-sdk/rpt`) |
| Prediction (self-trained) | scikit-learn classifiers (gradient boosting default) served via Python FastAPI |
| Resilience | `@sap-cloud-sdk/resilience` |
| UI | SAP Fiori Elements (List Report + Object Page) |
| Deployment | Cloud Foundry (MTA) |

## Domain Model

`Predictions` and `Evaluations` are **1:many** on `Claims` (one row per model run), with a `ModelRunConfig` table describing the requested run:

```
Claims (cuid, managed)
├── rawText, title, claimAmount, currency, claimType, status
├── fraudScoreProprietary / fraudScoreCustom        (denormalized list summaries)
├── riskLevelProprietary / riskLevelOpenSource      (denormalized list summaries)
├── actualFraud                                     (optional ground-truth label)
├── attachments    -> [Attachments]     (Composition, 1:N)
├── structuredData -> StructuredData     (Composition, 1:1) + token usage
├── predictions    -> [Predictions]      (Composition, 1:N) track/provider/model/score/status
├── evaluations    -> [Evaluations]      (Composition, 1:N) LLM-as-classifier + basedOnPrediction + tokens
└── runConfig      -> [ModelRunConfig]   (Composition, 1:N) which models run + isolated-track pairing
```

Status flow: `new` -> `structuring` -> `structured` -> `predicting` -> `predicted` -> `evaluating` -> `evaluated` -> `approved` | `flagged` (any step error -> `failed`)

Full entity model + ER diagram: [docs/ai/fraud-detection-pipeline.md](docs/ai/fraud-detection-pipeline.md). Term definitions: [docs/glossary.md](docs/glossary.md).

## Project Structure

```
db/                     Domain models (schema.cds, code lists, training data)
srv/                    Service definitions (*.cds) + thin handlers (*.ts) + server.js (ML autostart)
srv/code/               Implementation logic (one exported function per file)
srv/code/utils/         Shared utilities (aiClient, mlClient, runConfig, aicoreDeployment)
app/claims/             Fiori Elements app + UI annotations (comparison views, submit action)
ml/                     Python FastAPI ML service + scikit-learn models + datasets
scripts/                Tooling (deploy-oss-model, extract-demo-cases, split-training-data)
_i18n/                  Internationalization (labels, messages)
test/                   Jest tests + http/ (REST Client) + fixtures/ (demo cases)
docs/                   Documentation — see docs/README.md (index) + docs/ai/ guides
```

## Getting Started

```bash
npm install
cds deploy --to sqlite     # initialize local database
cds watch                  # start dev server (all services stubbed; auto-starts the ML API)
```

Optional one-time setup so the custom ML predict track runs for real locally (otherwise it falls back to a stub):

```bash
python3.12 -m venv ml/.venv
ml/.venv/bin/pip install -r ml/requirements.txt
```

| Endpoint | URL |
|----------|-----|
| Fiori UI | http://localhost:4004/claims/webapp/index.html |
| OData API | http://localhost:4004/service/ClaimService |
| Intake API | http://localhost:4004/api/intake |
| ML API (custom predict) | http://localhost:8000/docs |

Submit a claim — either via the **Submit Claim** toolbar action in the Claims List Report, or via the intake API (the claim runs with the default two isolated tracks; pass `predictModels` / `evaluations` to override):

```bash
curl -X POST http://localhost:4004/api/intake/submitClaim \
  -H "Content-Type: application/json" \
  -d '{"externalRef":"TEST-001","rawText":"Single-vehicle accident on the M4; driver lost control in heavy rain and hit the central barrier. Estimated repair USD 6,200, police report filed, no injuries."}'
```

More request examples (including multi-model overrides and the curated `Tathergang` demo cases) live in `test/http/`.

## Runtime Profiles

| Profile | Command | Services | Purpose |
|---------|---------|----------|---------|
| development | `cds watch` | all mocked/stubbed | Local development, airplane mode |
| hybrid | `cds watch --profile hybrid` | AI Core real, rest mocked | Integration testing |
| production | Cloud Foundry | all real | Deployed application |

For hybrid testing, bind AI Core credentials first:

```bash
cds bind aicore --to <service-instance>
cds watch --profile hybrid
```

## Documentation

Start at the **[documentation index](docs/README.md)** — a retrieval map of every guide. Key entries:

| Topic | Document |
|-------|----------|
| Glossary of all terms | [docs/glossary.md](docs/glossary.md) |
| Pipeline + entity model (ER diagram, isolated tracks) | [docs/ai/fraud-detection-pipeline.md](docs/ai/fraud-detection-pipeline.md) |
| SAP AI SDK (Claude, RPT-1, tokens, BYOM path) | [docs/ai/sap-ai-sdk-guide.md](docs/ai/sap-ai-sdk-guide.md) |
| Open-source LLMs on AI Core (BYOM, cost, infra) + switchable OpenRouter source | [docs/ai/open-source-llm-byom.md](docs/ai/open-source-llm-byom.md) |
| Custom ML service (FastAPI, field mapping) | [docs/ai/custom-ml-integration.md](docs/ai/custom-ml-integration.md) |
| Runtime, profiles, tests, deployment | [docs/ai/development-runtime.md](docs/ai/development-runtime.md) |
| Scientific scope & limitations | [docs/scientific-scope.md](docs/scientific-scope.md) |

## License

Proprietary.
