# Insurance Fraud Detection

An autonomous B2C insurance claim fraud detection system built on SAP Cloud Application Programming Model (CAP). Claims are ingested via integration APIs, processed through a multi-stage AI pipeline, and surfaced to fraud analysts via a Fiori Elements monitoring UI.

## Architecture

```
                          Autonomous Pipeline (CAP Transactional Event Queues)

 External Systems         tx1              tx2              tx3              tx4
 ┌────────────┐     ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
 │ Insurer    │────>│  Intake   │──>│ Structure │──>│  Predict  │──>│ Evaluate  │
 │ Portal /   │     │  (REST)   │   │  Agent    │   │  (RPT-1)  │   │  Agent    │
 │ Email / API│     └───────────┘   └───────────┘   └───────────┘   └───────────┘
 └────────────┘      ClaimIntake     Claude 4.6       SAP RPT-1      Claude 4.6
                      Service        Vision+LLM       Tabular ML      LLM

                          Fiori Elements (Internal Monitoring + Review)
                     ┌──────────────────────────────────────────────────┐
                     │  List Report: claims, status, fraud scores       │
                     │  Object Page: details, evidence, analyst actions │
                     └──────────────────────────────────────────────────┘
```

### Pipeline Steps

| Step | Purpose | Technology |
|------|---------|------------|
| **Intake** | Receive claims + attachments via REST API | CAP `@protocol: 'rest'` service |
| **Structure** | Extract structured fields from documents using LLM vision | `@sap-ai-sdk/orchestration` / `anthropic--claude-4.6-opus` |
| **Predict** | Classify fraud probability from tabular features | `@sap-ai-sdk/rpt` / `sap-rpt-1-large` |
| **Evaluate** | Generate human-readable risk assessment and recommendation | `@sap-ai-sdk/orchestration` / `anthropic--claude-4.6-opus` |
| **Review** | Analyst approves or flags claim in Fiori UI | SAP Fiori Elements (annotation-driven) |

Steps 1-4 execute autonomously as chained CAP transactional event queues. Step 5 is the single human interaction point.

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
| LLM | SAP AI Core via `@sap-ai-sdk/orchestration` |
| Prediction | SAP RPT-1 via `@sap-ai-sdk/rpt` |
| Resilience | `@sap-cloud-sdk/resilience` |
| UI | SAP Fiori Elements (List Report + Object Page) |
| Deployment | Cloud Foundry (MTA) |

## Domain Model

```
Claims (cuid, managed)
├── title, description, claimAmount, currency
├── claimType    -> ClaimTypes (code list)
├── status       -> ClaimStatuses (code list)
├── attachments  -> [Attachments]      (Composition, 1:N)
├── structuredData -> StructuredData   (Composition, 1:1)
├── prediction     -> Predictions      (Composition, 1:1)
└── evaluation     -> Evaluations      (Composition, 1:1)
```

Status flow: `new` -> `structuring` -> `structured` -> `predicting` -> `predicted` -> `evaluating` -> `evaluated` -> `approved` | `flagged`

## Project Structure

```
db/                     Domain models (schema.cds, code lists)
srv/                    Service definitions (*.cds) + thin event handlers (*.js)
srv/code/               Implementation logic (one exported function per file)
srv/code/utils/         Shared utilities (AI client wrappers)
app/claims/             Fiori Elements app + UI annotations
_i18n/                  Internationalization (labels, messages)
test/                   Unit + integration tests (Jest)
docs/ai/                AI agent reference documentation
```

## Getting Started

```bash
npm install
cds deploy --to sqlite     # initialize local database
cds watch                  # start dev server (all services mocked)
```

| Endpoint | URL |
|----------|-----|
| Fiori UI | http://localhost:4004/claims/webapp/index.html |
| OData API | http://localhost:4004/service/ClaimService |
| Intake API | http://localhost:4004/api/intake |

Submit a test claim:

```bash
curl -X POST http://localhost:4004/api/intake/submitClaim \
  -H "Content-Type: application/json" \
  -d '{"externalRef":"TEST-001","title":"Water damage claim","description":"Basement flooding after storm","claimAmount":4500,"currency":"USD","claimType":"property"}'
```

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

Detailed guides for contributors and AI coding assistants:

- [`docs/ai/cap-coding-standards.md`](docs/ai/cap-coding-standards.md) -- CAP patterns, CDS modeling, handler delegation, CQL, logging, i18n, service mocking
- [`docs/ai/sap-ai-sdk-guide.md`](docs/ai/sap-ai-sdk-guide.md) -- OrchestrationClient (Claude), RptClient (RPT-1), structured output, vision, resilience
- [`docs/ai/fraud-detection-pipeline.md`](docs/ai/fraud-detection-pipeline.md) -- Pipeline architecture, entity model, event queue chaining, status flow
- [`docs/ai/fiori-elements-guide.md`](docs/ai/fiori-elements-guide.md) -- Annotation-driven UI, List Report, Object Page, criticality
- [`docs/ai/development-runtime.md`](docs/ai/development-runtime.md) -- Profiles, airplane mode, hybrid testing, Cloud Foundry deployment

## License

Proprietary.
