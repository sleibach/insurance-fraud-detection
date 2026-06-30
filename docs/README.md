---
title: Documentation Index
summary: Canonical entry point and retrieval map for all insurance-fraud-detection documentation — architecture, multi-model pipeline, SAP AI SDK, BYOM open-source LLMs, custom ML integration, runtime, and scientific scope.
keywords: [documentation index, fraud detection, SAP CAP, multi-model, BYOM, RPT-1, Claude, gpt-oss, gemma, Fiori Elements, docs map]
audience: [developers, AI agents, presenters]
related:
  - ../readme.md
  - glossary.md
  - scientific-scope.md
  - ai/fraud-detection-pipeline.md
  - ai/sap-ai-sdk-guide.md
  - ai/open-source-llm-byom.md
  - ai/custom-ml-integration.md
  - ai/development-runtime.md
  - ai/cap-coding-standards.md
  - ai/fiori-elements-guide.md
last_updated: 2026-06-28
---

# Documentation Index

**TL;DR** — This project is an SAP CAP backend + Fiori Elements UI that runs every insurance claim through a **multi-model fraud-detection pipeline**: each claim is scored by several **predict** models (SAP RPT-1 + custom ML) and reasoned over by several **evaluate** LLMs (proprietary Claude + self-hosted open-source) **in parallel, in isolated tracks**, so proprietary and open-source models can be compared side by side. This index maps every doc so an agent or reader can jump straight to the right context.

## How to use this index

Each entry lists the document, a one-line summary, and the keywords it owns. Start here, then follow the link. All docs use YAML frontmatter + a TL;DR so you can retrieve a single self-contained section without reading the whole tree.

## Top-level

| Document | Summary | Keywords |
|----------|---------|----------|
| [readme.md](../readme.md) | Project overview, architecture diagram, multi-model story, quick start, runtime profiles. | overview, architecture, getting started, profiles |
| [docs/glossary.md](glossary.md) | Definitions of every domain + project term (track, run-config, BYOM, RPT-1, isolated tracks, LLM-as-classifier). | glossary, terminology, definitions |
| [docs/scientific-scope.md](scientific-scope.md) | What the comparison does and does **not** claim; accepted data-leakage caveat; how comparison is measured. | scope, limitations, leakage, evaluation, reproducibility |

## Pipeline & architecture

| Document | Summary | Keywords |
|----------|---------|----------|
| [docs/ai/fraud-detection-pipeline.md](ai/fraud-detection-pipeline.md) | The 4-step pipeline (Structure → Predict → Evaluate → Review), the multi-model **cardinality** entity model (ER diagram), run-config, isolated tracks, LLM-as-classifier, status flow, airplane-mode stubs. | pipeline, entity model, cardinality, run-config, isolated tracks, event queue, status flow |
| [docs/ai/cap-coding-standards.md](ai/cap-coding-standards.md) | CAP folder structure, handler delegation, CQL, annotations, service mocking & airplane mode. | CAP, CDS, CQL, handler pattern, mocking |

## AI integration

| Document | Summary | Keywords |
|----------|---------|----------|
| [docs/ai/sap-ai-sdk-guide.md](ai/sap-ai-sdk-guide.md) | `OrchestrationClient` (Claude), `RptClient` (RPT-1), **token usage capture**, and the **BYOM OpenAI-compatible** chat path for self-hosted open models. | SAP AI SDK, OrchestrationClient, RptClient, token usage, BYOM, chat completion |
| [docs/ai/open-source-llm-byom.md](ai/open-source-llm-byom.md) | Self-hosting gpt-oss-120b / gpt-oss-20b / gemma-3-27b on SAP AI Core (vLLM, instance types, scale-to-zero), infra (AWS Frankfurt, not Sovereign), cost model, `scripts/deploy-oss-model.ts`. | BYOM, open-source LLM, gpt-oss, gemma, vLLM, AI Core, scale-to-zero, cost, instance type, H100, L4, L40S |
| [docs/ai/custom-ml-integration.md](ai/custom-ml-integration.md) | The Python FastAPI ML service (`ml/`), the 6 scikit-learn models, field mapping, `mlClient`, and auto-start with `cds watch`. | custom ML, FastAPI, scikit-learn, gradient boosting, field mapping, mlClient, uvicorn |

## Runtime & operations

| Document | Summary | Keywords |
|----------|---------|----------|
| [docs/ai/development-runtime.md](ai/development-runtime.md) | Profiles (development/hybrid/production), airplane mode, **ML API auto-start**, hybrid AI Core + BYOM deploy, Cloud Foundry, npm scripts, tests (Jest/OPA/E2E). | runtime, profiles, hybrid, airplane mode, ML autostart, deployment, npm scripts, testing |
| [docs/ai/fiori-elements-guide.md](ai/fiori-elements-guide.md) | Annotation-driven Fiori Elements patterns for the Claims List Report + Object Page comparison views. | Fiori Elements, annotations, List Report, Object Page |

## Quick navigation by question

- **"How does a claim flow through the system?"** → [fraud-detection-pipeline.md](ai/fraud-detection-pipeline.md)
- **"What is an isolated track / run-config?"** → [glossary.md](glossary.md) + [fraud-detection-pipeline.md](ai/fraud-detection-pipeline.md#run-configuration--isolated-tracks)
- **"How do we count tokens?"** → [sap-ai-sdk-guide.md](ai/sap-ai-sdk-guide.md#token-usage-capture)
- **"How is the open-source LLM hosted, and what does it cost?"** → [open-source-llm-byom.md](ai/open-source-llm-byom.md)
- **"How do the custom ML models work?"** → [custom-ml-integration.md](ai/custom-ml-integration.md)
- **"What can we claim scientifically?"** → [scientific-scope.md](scientific-scope.md)
- **"How do I run it locally / in hybrid?"** → [development-runtime.md](ai/development-runtime.md)
