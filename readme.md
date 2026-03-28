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
                      Service        Vision+LLM       │RPT-1 │Random│     │Claude│ GPT  │
                                                      │(SAP) │Forest│     │ 4.6  │ OSS  │
                                                      └──────┴──────┘     └──────┴──────┘
                                                       SAP AI   Self-      SAP AI  Self-
                                                       Core    trained     Core   hosted

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

The Predict and Evaluate steps run in **multi-model mode**: each claim is processed by multiple models in parallel so their results can be compared side-by-side.

| Step | Model A (SAP AI Core) | Model B (Self-managed) | Purpose |
|------|-----------------------|------------------------|---------|
| **Predict** | SAP RPT-1 (`@sap-ai-sdk/rpt` / `sap-rpt-1-large`) | Self-trained Random Forest | Compare a managed foundation model against a domain-specific model trained on historical claim data |
| **Evaluate** | Claude 4.6 (`@sap-ai-sdk/orchestration` / `anthropic--claude-4.6-opus`) | Self-hosted GPT OSS | Compare a managed commercial LLM against an open-source LLM under full operational control |

Both model results are stored per claim and surfaced in the Fiori Object Page, giving fraud analysts transparency into model agreement/disagreement and helping the team benchmark model quality over time.

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
| LLM (self-hosted) | GPT OSS -- open-source model under own infrastructure |
| Prediction (managed) | SAP RPT-1 via SAP AI Core (`@sap-ai-sdk/rpt`) |
| Prediction (self-trained) | Random Forest -- trained on historical claim data |
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

## License

Proprietary.
