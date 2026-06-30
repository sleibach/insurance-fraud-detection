---
title: Glossary
summary: Single-source definitions of every domain and project term used across the insurance fraud detection system — pipeline stages, tracks, run-config, model providers, BYOM, RPT-1, LLM-as-classifier, and token counting.
keywords: [glossary, terminology, track, run-config, isolated tracks, BYOM, RPT-1, gpt-oss, gemma, LLM-as-classifier, proprietary, open-source, custom ML, token usage]
audience: [developers, AI agents, presenters]
related:
  - README.md
  - ai/fraud-detection-pipeline.md
  - ai/open-source-llm-byom.md
  - ai/custom-ml-integration.md
  - scientific-scope.md
last_updated: 2026-06-28
---

# Glossary

**TL;DR** — Define each term once here and link to it from everywhere else. Terms are grouped by area: pipeline, models & tracks, data model, AI SDK, and runtime.

## Pipeline stages

- **Intake** — Entry point. External systems POST a claim to `ClaimIntakeService.submitClaim` (REST, `/api/intake`). The unbound `ClaimService.submitClaim` action exposes the same logic on the Fiori List Report toolbar. Creates the `Claims` row, persists the run-config, and schedules the first event.
- **Structure (Structure Agent)** — Async event `StructureClaim`. An LLM (Claude, vision-capable) extracts structured fields from the claim's `rawText` / attachments into `StructuredData` + `StructuredDataFields`. Captures LLM **token usage**.
- **Predict** — Async event `PredictFraud`. Runs every requested predict model **in parallel**, one `Predictions` row per model. See **predict model**.
- **Evaluate** — Async event `EvaluateClaim`. Runs every requested evaluate LLM **in parallel, isolated**, one `Evaluations` row per model. Each LLM acts as an **LLM-as-classifier**.
- **Review** — Human step. A fraud analyst reviews the side-by-side comparison in the Fiori UI and approves or flags the claim (`approveClaim` / `flagClaim`).

## Models, providers & tracks

- **Track** — A processing lane that ties a prediction to the evaluation that consumes it. Values: `proprietary`, `custom`, `opensource`. Used to group/compare results and to populate the List Report summary columns.
- **Isolated tracks** — The design rule that each evaluation reasons over **exactly one** prediction (`Evaluations.basedOnPrediction`), set from the run-config's `inputPredictModel`. Default: Claude evaluates the SAP RPT-1 score; the open-source LLM evaluates the custom-ML score. This keeps the two lanes independent and comparable.
- **Predict model** — A fraud-probability scorer. Two providers:
  - **`sap-rpt`** (track `proprietary`): SAP RPT-1 Table Transformer (`sap-rpt-1-large` / `-small`) via `@sap-ai-sdk/rpt`.
  - **`custom-ml`** (track `custom`): a self-trained scikit-learn model served by the local FastAPI — `gbc` (gradient boosting, default), `rf`, `svm`, `lr`, `knn`, `nb`.
- **Evaluate model** — An LLM that reasons about a prediction and emits a classification + explanation. Two providers:
  - **`anthropic`** (track `proprietary`): `anthropic--claude-4.6-opus` via `OrchestrationClient`.
  - **`aicore-byom`** (track `opensource`): a self-hosted open model (`gpt-oss-120b` default, `gpt-oss-20b`, `gemma-3-27b`) via the OpenAI-compatible BYOM path.
- **Proprietary** — Managed/commercial models on SAP AI Core (SAP RPT-1, Claude).
- **Open-source** — Open-weight LLMs self-hosted on SAP AI Core via **BYOM** (gpt-oss, gemma).
- **Custom (ML)** — The self-trained tabular classifiers in `ml/`, served via FastAPI.
- **BYOM (Bring Your Own Model)** — Self-hosting an open-weight model as a custom **vLLM** deployment on SAP AI Core (data stays in SAP). Exposes an OpenAI-compatible `/v1/chat/completions` API. See [open-source-llm-byom.md](ai/open-source-llm-byom.md).
- **RPT-1** — SAP's **Relational Pretrained Transformer** ("Table Transformer") foundation model for tabular prediction. Few-shot: training rows are sent alongside the prediction row for context.
- **LLM-as-classifier** — The evaluate LLMs are prompted to emit a calibrated `fraudProbability` (0–1) **and** a binary `fraudDecision` alongside the narrative, so each LLM can be compared as a classifier against the ground-truth label and against the other models.

## Run configuration

- **Run-config** — The "run setting" chosen at submit time: which predict models to run and which evaluate LLMs to run, each evaluation paired to an `inputPredictModel`. Persisted as `ModelRunConfig` rows and carried in the pipeline event payloads so queued steps are self-contained. Defaults to the two isolated tracks when omitted. See `srv/code/utils/runConfig.ts`.
- **`inputPredictModel`** — On an evaluate run-config row, the name of the predict model whose result that evaluation consumes. This is what makes tracks isolated.
- **`ModelRunConfig`** — The CDS entity persisting run-config rows (`stage`, `track`, `modelName`, `inputPredictModel`, `sequence`).

## Data model

- **Claims** — The aggregate root. Holds `rawText`, structured summary fields, optional `actualFraud` label, and denormalized comparison summaries (`fraudScoreProprietary`, `fraudScoreCustom`, `riskLevelProprietary`, `riskLevelOpenSource`). Compositions: `predictions` (many), `evaluations` (many), `structuredData` (one), `runConfig` (many), `attachments` (many).
- **Predictions** (many per claim) — One row per predict model run: `track`, `provider`, `modelName`, `fraudScore`, `predictedClass`, `status`, `latencyMs`, `modelVersion`.
- **Evaluations** (many per claim) — One row per evaluate model run: `track`, `provider`, `modelName`, `promptVersion`, `basedOnPrediction`, `fraudProbability`, `fraudDecision`, `decisionCriticality`, `riskLevel`, `summary`, `keyFactors`, `recommendation`, token columns, `status`, `latencyMs`.
- **StructuredData** (one per claim) — Extracted fields + extraction confidence + structure-agent token usage.
- **`actualFraud`** — Optional ground-truth label on a claim, set only for labeled demo cases (from the `Tathergang` dataset). Drives predicted-vs-actual coloring in the UI.
- **`decisionCriticality`** — Integer on an evaluation used for UI `Criticality`: `3` = decision matches `actualFraud` (green), `1` = wrong (red), `0` = no label.
- **`status` (run status)** — `success` (real model answered), `stub` (model unreachable → deterministic fallback, airplane mode), `failed` (model errored but the run continued).

## AI SDK & tokens

- **`OrchestrationClient`** — `@sap-ai-sdk/orchestration` harmonized LLM client used for Claude (proprietary track). Model switch = change the name string.
- **`RptClient`** — `@sap-ai-sdk/rpt` client for RPT-1 tabular prediction.
- **OpenAI-compatible BYOM path** — Direct `fetch` to `<deploymentUrl>/v1/chat/completions` (AI Core bearer token + `AI-Resource-Group` header) used for self-hosted open models. Implemented in `createOpenSourceChatClient`.
- **Token usage** — `{ promptTokens, completionTokens, totalTokens }`. `completionTokens` are the **output tokens**. Captured for the structure agent (`StructuredData`) and every evaluation (`Evaluations`) for cost tracking.

## Runtime

- **Airplane mode** — The rule that `cds watch` runs fully offline: every remote call (AI Core, RPT-1, ML API) has a try/catch stub fallback. See [development-runtime.md](ai/development-runtime.md).
- **Profiles** — `development` (default, all stubbed), `hybrid` (real AI Core, local DB), `production` (all real). See [development-runtime.md](ai/development-runtime.md).
- **ML API auto-start** — `srv/server.js` spawns the `ml/` FastAPI (uvicorn) on `cds watch` and stops it on shutdown; skipped gracefully if Python/deps missing.
- **Tathergang** — German for "course of events"; the free-text narrative column in `ml/data/fraud_oracle_tathergaenge.csv`. Curated narratives become demo/test claims (`test/fixtures/demo-cases.json`).
