# CLAUDE.md

Guidance for AI coding assistants (Claude Code, Cursor, etc.) working in this repository.

## Project Overview

- **Name**: insurance-fraud-detection
- **Type**: SAP CAP full-stack app with Fiori Elements frontend
- **Purpose**: B2C insurance scam detection system with AI-powered analysis pipeline
- **Backend**: Node.js + SAP CAP (`@sap/cds`)
- **Frontend**: SAP Fiori Elements (annotation-driven)
- **AI**: SAP AI SDK (`@sap-ai-sdk/foundation-models`) via SAP AI Core

## Architecture

4-step fraud detection pipeline:

1. **Input** -- User submits a claim with attachments via Fiori Elements UI
2. **Structure Agent** -- Claude (LLM + Vision) extracts structured data from documents
3. **Predict** -- SAP RPT-1 Table Transformer predicts fraud probability from structured data
4. **Evaluate** -- Claude (LLM) reasons about the prediction and explains the score

## Folder Structure

```
db/           → Domain models (schema.cds)
srv/          → Service definitions (*.cds) + thin handler files (*.js)
srv/code/     → Implementation logic modules (one function per file)
srv/code/utils/ → Shared utilities
app/          → Fiori Elements apps + UI annotations
docs/ai/      → AI agent reference docs (coding standards, guides)
```

## Development Commands

- Install: `npm install`
- Run locally: `cds watch`
- Deploy DB: `cds deploy --to sqlite`

## Coding Standards

All coding standards live in `docs/ai/` -- **read these before writing code**:

- **CAP coding standards**: read [docs/ai/cap-coding-standards.md](docs/ai/cap-coding-standards.md) for folder structure, CDS modeling, handler pattern, CQL usage, and common pitfalls
- **SAP AI SDK patterns**: read [docs/ai/sap-ai-sdk-guide.md](docs/ai/sap-ai-sdk-guide.md) for LLM integration via `@sap-ai-sdk/foundation-models`
- **Fiori Elements**: read [docs/ai/fiori-elements-guide.md](docs/ai/fiori-elements-guide.md) for annotation-driven UI development
- **Pipeline architecture**: read [docs/ai/fraud-detection-pipeline.md](docs/ai/fraud-detection-pipeline.md) for the 4-step workflow, entity model, and integration points

## Critical Rules (Quick Reference)

1. **Handler files are thin** -- `srv/*.js` only wires events to `srv/code/` modules, no business logic
2. **Always use CQL** -- never write raw SQL; use `SELECT`, `INSERT`, `UPDATE`, `DELETE` from `cds.ql`
3. **Annotations over code** -- prefer CDS annotations for authorization, validation, UI, draft behavior
4. **SAP AI SDK only** -- use `@sap-ai-sdk/foundation-models` for all LLM calls, never generic OpenAI SDK
5. **UI annotations in app/** -- never put `@UI.*` annotations in `srv/` or `db/` files

## Preferred Change Workflow

1. Read the relevant `docs/ai/` guide for the area you're changing
2. Inspect impacted CDS models and service handlers
3. Implement the smallest safe change following the established patterns
4. Run `cds watch` to verify the service boots correctly
5. Summarize behavior impact, especially on draft semantics and the pipeline flow
