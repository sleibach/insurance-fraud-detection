# Fraud Detection Pipeline

Architecture and data flow for the insurance fraud detection system. This document describes the 4-step pipeline from claim intake to fraud evaluation.

## Pipeline Overview

```
Step 1: Input        Step 2: Structure     Step 3: Predict       Step 4: Evaluate
┌──────────────┐    ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Claim + Docs │───>│ Structure Agent   │──>│ Table Transformer│──>│ Evaluation Agent  │
│              │    │ (Claude Vision)   │   │ (SAP RPT-1)      │   │ (Claude LLM)      │
│ Raw input    │    │ Extract fields    │   │ Predict fraud    │   │ Reason about      │
│ from user    │    │ from documents    │   │ score from data  │   │ prediction result  │
└──────────────┘    └──────────────────┘   └──────────────────┘   └──────────────────┘
```

## Entity Model

### Core Entities

```
Claims (cuid, managed)
├── title, description, claimAmount, currency
├── claimType -> ClaimTypes
├── status -> ClaimStatuses
├── attachments -> [Attachments]      (Composition)
├── structuredData -> StructuredData   (Composition, 1:1)
├── prediction -> Predictions          (Composition, 1:1)
└── evaluation -> Evaluations          (Composition, 1:1)

Attachments (cuid, managed)
├── filename, mediaType, content (LargeBinary)
└── claim -> Claims (parent)

StructuredData (cuid, managed)
├── Extracted fields from documents (claimType, incidentDate, claimAmount, etc.)
├── extractionConfidence : Decimal
└── claim -> Claims (parent)

Predictions (cuid, managed)
├── fraudScore : Decimal(5,4)         (0.0 = legitimate, 1.0 = fraud)
├── modelVersion : String
├── predictionTimestamp : Timestamp
└── claim -> Claims (parent)

Evaluations (cuid, managed)
├── summary : String(5000)            (Human-readable explanation)
├── riskLevel : String                (low/medium/high/critical)
├── keyFactors : LargeString          (JSON array of contributing factors)
├── recommendation : String(1000)
└── claim -> Claims (parent)
```

### Status Flow

```
new -> structuring -> structured -> predicting -> predicted -> evaluating -> evaluated -> reviewed
```

## Step 1: Input

**Purpose**: Accept a new insurance claim with supporting documents.

**Trigger**: User creates a claim via Fiori Elements UI (draft-enabled).

**Data**:
- Claim metadata (title, description, amount, type)
- Attachments (photos, PDFs, invoices) uploaded via the Object Page

**Implementation**:
- Standard CAP draft flow -- no custom logic needed for basic CRUD
- `before CREATE` handler validates required fields
- Attachments stored via CAP's media handling (`@Core.MediaType`, `@Core.ContentDisposition`)

## Step 2: Structure Agent

**Purpose**: Use an LLM with vision capabilities to extract structured data from claim documents.

**Trigger**: Action `structureClaim` on Claims entity (manual or automatic after claim submission).

**Model**: Claude Opus 4.6 (via SAP AI Core) -- chosen for strong vision + structured output.

**Implementation** (`srv/code/claims-on-structureClaim-logic.js`):
1. Load claim with attachments
2. For each attachment, convert to base64 if image, or render PDF pages as images
3. Send to Claude vision model with structured output schema
4. Merge extracted data from all attachments into a single `StructuredData` record
5. Update claim status to `structured`

**Key considerations**:
- Use `response_format` with `json_schema` for reliable extraction
- Handle multi-page documents by sending multiple images in one request
- Store extraction confidence score for transparency
- Low temperature (0.0) for deterministic extraction

## Step 3: Predict

**Purpose**: Run the structured claim data through SAP RPT-1 Table Transformer to predict fraud probability.

**Trigger**: Automatic after Step 2 completes (or action `predictFraud`).

**Model**: SAP RPT-1 Table Transformer -- trained on confirmed claim data (synthetic for now).

**Implementation** (`srv/code/claims-on-predictFraud-logic.js`):
1. Load structured data for the claim
2. Format as tabular input matching the training schema
3. Call the RPT-1 model endpoint
4. Store prediction result (fraud score, model version, timestamp) in `Predictions`
5. Update claim status to `predicted`

**Key considerations**:
- Synthetic training data initially -- plan for real data integration later
- Feature engineering: transform structured fields into model-compatible format
- Store model version for reproducibility
- The fraud score is a probability (0.0 to 1.0)

## Step 4: Evaluate

**Purpose**: Use an LLM to reason about the prediction result, explain contributing factors, and provide a recommendation.

**Trigger**: Automatic after Step 3 completes (or action `evaluateClaim`).

**Model**: Claude (via SAP AI Core) -- chosen for strong reasoning capabilities.

**Implementation** (`srv/code/claims-on-evaluateClaim-logic.js`):
1. Load claim with structured data and prediction
2. Compose a prompt including:
   - Original claim data
   - Structured extraction results
   - Fraud score and model metadata
   - Known fraud patterns / risk indicators
3. Request a structured evaluation (summary, risk level, key factors, recommendation)
4. Store in `Evaluations`
5. Update claim status to `evaluated`

**Key considerations**:
- Use structured output for consistent evaluation format
- Include the fraud score context (what threshold means what)
- The evaluation should explain *why* the score is what it is
- Moderate temperature (0.3-0.5) for nuanced reasoning while maintaining consistency
- This step adds human-understandable context to the raw prediction

## Integration Points

### SAP AI Core
- All LLM calls go through `@sap-ai-sdk/foundation-models`
- RPT-1 calls may use a different SDK or direct REST endpoint via `@sap-cloud-sdk/http-client`
- AI Core destination configured in `package.json` under `cds.requires`

### Service Actions

```cds
service ClaimService {
  entity Claims as projection on db.Claims;

  // Pipeline actions
  action structureClaim(claimId : UUID) returns StructuredData;
  action predictFraud(claimId : UUID) returns Predictions;
  action evaluateClaim(claimId : UUID) returns Evaluations;

  // Run full pipeline
  action processClaim(claimId : UUID) returns Evaluations;
}
```

### Orchestration

`processClaim` runs all three steps sequentially:
1. `structureClaim` -> wait for completion
2. `predictFraud` -> wait for completion
3. `evaluateClaim` -> return final evaluation

Each step can also be triggered independently for debugging/reprocessing.
