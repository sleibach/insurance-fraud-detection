---
name: fraud-detection-pipeline
description: >-
  Insurance fraud detection pipeline architecture and data flow. Use when
  working on the fraud detection workflow, claims processing, pipeline steps,
  structure agent, prediction, evaluation agent, or entity relationships.
---

# Fraud Detection Pipeline

## Architecture

Read `docs/ai/fraud-detection-pipeline.md` for the complete pipeline documentation including:
- 4-step pipeline overview (Input -> Structure -> Predict -> Evaluate)
- Entity model (Claims, Attachments, StructuredData, Predictions, Evaluations)
- Status flow (new -> structuring -> structured -> predicting -> predicted -> evaluating -> evaluated -> reviewed)
- Implementation details for each step
- Service actions (structureClaim, predictFraud, evaluateClaim, processClaim)
- Integration points (SAP AI Core, RPT-1)

## Step Summary

| Step | Agent | Model | Input | Output |
|------|-------|-------|-------|--------|
| 1. Input | User | -- | Claim + attachments | Claims entity |
| 2. Structure | Structure Agent | Claude (Vision) | Claim documents | StructuredData |
| 3. Predict | Table Transformer | SAP RPT-1 | Structured tabular data | Predictions (fraud score) |
| 4. Evaluate | Evaluation Agent | Claude (LLM) | Score + claim context | Evaluations (explanation) |

## Related Standards

- For CAP implementation patterns: `docs/ai/cap-coding-standards.md`
- For AI SDK usage in agents: `docs/ai/sap-ai-sdk-guide.md`
- For UI to display results: `docs/ai/fiori-elements-guide.md`
