---
title: Live Demo Runbook — Multi-Model Fraud Detection (focused)
summary: A focused three-case demo script for the insurance fraud detection pipeline — a clean legitimate claim (warm-up), a legitimate-but-fraudy-looking claim (false-positive trap), and one clear fraud (maximum red flags). Each is paired with a deliberately chosen multi-model run configuration that showcases isolated proprietary vs open-source tracks and evaluator-size comparisons. Includes image-generation prompts to create mock claim documents for the vision structure agent. Pairs with ./live-demo.http.
keywords: [live demo, demo runbook, Tathergang, fraud cases, false-positive trap, run configuration, isolated tracks, predictModels, evaluations, sap-rpt-1-large, gbc, rf, anthropic--claude-4.6-opus, gpt-oss-120b, gpt-oss-20b, gemma-3-27b, OpenRouter, actualFraud, predicted-vs-actual, List Report, Object Page, submitClaim, Pipeline Configuration Advanced, image generation prompt, claim document, FNOL, vision structure agent]
audience: [presenters, developers, architects, AI agents]
related:
  - test/http/live-demo.http
  - test/http/intake.http
  - test/http/monitor.http
  - docs/ai/fraud-detection-pipeline.md
  - docs/ai/open-source-llm-byom.md
  - docs/ai/development-runtime.md
last_updated: 2026-06-30
---

# Live Demo Runbook — Multi-Model Fraud Detection (focused)

A focused **three-case** walkthrough that demonstrates the full autonomous
pipeline and the side-by-side **proprietary vs open-source** model comparison.
The cases are chosen to tell the whole story in minutes: a clean legit baseline,
then the system **does not over-flag** an honest claim that merely looks
suspicious, and finally it **catches real fraud**. The requests live in
[`./live-demo.http`](./live-demo.http); this is the narration.

## Data provenance

Both claim narratives are real rows from the demo dataset
(`ml/data/fraud_oracle.xlsx` → `ml/data/fraud_oracle_tathergaenge.csv`). The
`Tathergang` free-text becomes the claim `rawText`; the dataset's `FraudFound_P`
flag becomes the `actualFraud` ground-truth label, so the UI can colour each
model's **predicted-vs-actual** decision (green = correct, red = wrong).

## Prerequisites

```bash
# Open-source evaluators served live via OpenRouter (BTP destination);
# proprietary models (Claude, RPT-1) via SAP AI Core; custom ML via local FastAPI.
CF_HOME=. OSS_LLM_SOURCE=destination cds watch --profile hybrid
```

- Backend reachable at `http://localhost:4004`, Claims app at
  `http://localhost:4004/claims/webapp/index.html`.
- The custom ML FastAPI auto-starts with `cds watch` (serves `gbc`, `rf`, …).
- Fire the `.http` requests **in order**; the pipeline runs autonomously per claim.

## Demo images (FNOL + damage photos)

Pre-generated PNGs live alongside this runbook in `test/http/`:

| Case | FNOL form | Damage photo |
|---|---|---|
| A (clean legit) | `A-FNOL.png` | `A-Damage.png` |
| B (legit trap) | `B-FNOL.png` | `B-Damage.png` |
| C (fraud) | `C-FNOL.png` | `C-Damage.png` |

**UI path:** Submit Claim → **Add files** → select one or both PNGs for the case.
You can leave the narrative empty (image-only intake) or paste the matching
`rawText` from [`live-demo.http`](./live-demo.http) for a richer comparison.

**REST path:** add an `attachments` array with base64 `content` (see
[`intake.http`](./intake.http)). Large payloads need the 30 MB body limit in
`package.json` (`cds.server.body_parser.limit`).

**What to watch:** Object Page → **Attachments** (stored files), **Structured Data**
(extracted fields + high prompt-token count proving vision ran), **Predictions**,
**Evaluations**.

## How to present each claim

1. Send the request (or use the UI **Submit Claim** dialog — paste narrative and/or
   **upload FNOL/damage images** via **Add files**; optionally expand **Pipeline
   Configuration (Advanced)** to set models by hand).
2. In the **List Report**, watch the claim march through the process-flow
   (Intake → Structure → Predict → Evaluate → Review) and land on **Evaluated**,
   with the **Risk Level (Proprietary)** and **Risk Level (Open Source)** columns
   filling in.
3. Open the **Object Page → Predictions** and **Evaluations** tables for the
   side-by-side comparison: track, provider, model, risk level, fraud decision,
   token counts, and latency. The decision cell is colour-coded against
   `actualFraud`.

## The run-configuration knobs

| Field | Meaning |
|---|---|
| `predictModels` | Which prediction models run in parallel. `sap-rpt-1-large` = SAP RPT-1 (proprietary track); `gbc`/`rf`/… = custom ML (local FastAPI). |
| `evaluations[].model` | The evaluator LLM. `anthropic--claude-4.6-opus` = proprietary; `gpt-oss-120b` / `gpt-oss-20b` / `gemma-3-27b` = open source (OpenRouter). |
| `evaluations[].inputPredictModel` | Which prediction that evaluator reasons over — this is what makes the tracks **isolated** and comparable. |
| `actualFraud` | Optional ground-truth label (demo/labelled cases only). |

Omit `predictModels`/`evaluations` entirely to get the **default two isolated
tracks**: predict `sap-rpt-1-large` + `gbc`; evaluate Claude←RPT and
`gpt-oss-120b`←gbc.

## The three cases

| # | External Ref | Truth | Dataset red flags | Config theme | What to point at |
|---|---|---|---|---|---|
| A | `DEMO-A-LEGIT-CLEAN` | **legit** | police filed, 1st claim, none | **Default two tracks** (baseline) | Both tracks → **low** risk, decisions green. The happy path. |
| B | `DEMO-B-LEGIT-LOOKSFRAUDY` | **legit** | no police, supplements, prior claims, >69k — looks bad, is fine | **Full 4-model panel** on one prediction (Claude · 120b · 20b · gemma ←gbc) | Strong models stay calibrated (green); weaker ones may over-flag → false-positive resistance. |
| C | `DEMO-C-FRAUD-REDFLAGS` | **fraud** | no police, >5 supplements, >4 prior claims, >69k, at fault | **3-way evaluator** across 3 predictions (Claude←RPT · 120b←gbc · gemma←rf) | All tracks → **high/critical**; "models agree on fraud". |

### Suggested narration arc

1. **Case A (clean legit)** — establish the happy path and what "good" looks
   like: both tracks confidently land **low** risk, decisions green.
2. **Case B (legit trap)** — the contrast. Read the narrative aloud: it has every
   surface red flag (no police, mounting supplements, prior claims, expensive
   vehicle, at fault). Show that the strong models (Claude, gpt-oss-120b) keep it
   **low/medium and decide legit (green)** — the pipeline reasons, it doesn't just
   key on red flags. Point at any weaker model (20b/gemma) that over-flags to
   motivate **why model choice matters**.
3. **Case C (clear fraud)** — the obvious one. Show the whole comparison grid
   lighting up **high/critical** across the proprietary and open-source tracks —
   "the models agree on fraud" — and pull up the token + latency columns to talk
   cost/performance per model.

> **One-line takeaway for the audience:** *"Same pipeline, multiple models in
> parallel — it catches the fraud and leaves the honest claims alone."*

## Expected pipeline behaviour (not a guarantee)

Outputs are live model calls and will vary run to run:

- **Case A (clean legit)** → **low** risk, `fraudDecision = false` on both tracks.
- **Case B (legit, looks fraudy)** → Claude and gpt-oss-120b should land
  **low/medium**, `fraudDecision = false` (green). The smaller/weaker models
  (gpt-oss-20b, gemma-3-27b) may over-flag — that contrast *is* the point.
- **Case C (clear fraud)** → **high/critical** risk, `fraudDecision = true` on
  every track.

If an open-source evaluator is unreachable, that single track falls back to a
`stub` evaluation (status `stub`) and the rest of the pipeline still completes.
Switch the open-source source back to self-hosted AI Core BYOM by unsetting
`OSS_LLM_SOURCE` (see `docs/ai/open-source-llm-byom.md`).

## Image-generation prompts (mock claim documents for the vision structure agent)

The structure agent is **multimodal** — in production it reads claim *documents*
(forms, reports, damage photos). For a richer demo you can attach a generated
claim-document image instead of (or alongside) the raw text. Paste these prompts
into an image model (and keep the on-form text short so it renders legibly).

**Reusable template (First Notice of Loss form):**

> A realistic, slightly skewed scanned photograph of a one-page auto-insurance
> *First Notice of Loss (FNOL)* claim form on white paper. Plain insurer
> letterhead "Helvetia Auto Insurance" at the top with a small logo. A mix of
> printed labels and neatly handwritten entries. Visible fields: Claim Ref,
> Policyholder, Vehicle (make / model / age), Date of accident, Location, Police
> report filed (Yes/No checkboxes), At fault (Yes/No), Prior claims (number),
> Deductible, and a large "Description of incident" box. Photorealistic office
> document, even lighting, legible text, no watermarks. Description box reads:
> "<SHORT_NARRATIVE>".

**Case A — clean legitimate:**

> [Use the template.] Claim Ref: DEMO-A. Vehicle: Honda Sport (high trim),
> 3 years old. Location: city off-ramp, icy. Police report: Yes. At fault: Yes.
> Prior claims: 0. Deductible: $400. Description box reads: "Single-vehicle
> accident — hit ice on an off-ramp and clipped the concrete barrier. Front
> quarter panel, headlight and bumper damaged. Police filed a report." Make it
> look like a tidy, complete, by-the-book form.

**Case B — legitimate but looks fraudy (false-positive trap):**

> [Use the template.] Claim Ref: DEMO-B. Vehicle: Ford Utility, 8 years old.
> Location: narrow city street. Police report: No. At fault: Yes. Prior claims: 3.
> Deductible: $400. Description box reads: "Sideswiped a parked van on a narrow
> street; passenger-side door and rear panel scraped, wing mirror knocked off.
> Left a note; owner called within the hour and we settled it." Make it look like
> an ordinary, honestly filled-out form.

**Case C — clear fraud (max red flags):**

> [Use the template.] Claim Ref: DEMO-C. Vehicle: Chevrolet Utility (high-end),
> 7 years old. Location: busy urban road. Police report: No. At fault: Yes. Prior
> claims: 5+. Deductible: $400. Description box reads: "Single-vehicle accident,
> drifted into a concrete divider. Front-driver corner plus underbody damage. Body
> shop still adding supplements months later." Attach a small "Supplements: 6"
> annotation and a couple of handwritten margin notes to hint at an over-built file.

**Damage photo — Case A (clean legit, Honda Sport):**

> A photorealistic smartphone snapshot of the front quarter-panel of a black
> Honda sports coupe after sliding into a concrete highway barrier. Crumpled front
> fender, cracked headlight, scuffed and dented front bumper with grey concrete
> transfer marks. Night/early-morning lighting near a road off-ramp, faint ice on
> the ground, slightly off-angle handheld shot, no people, no text. Damage is
> consistent with a genuine low-speed barrier impact.

**Damage photo — Case B (legit but looks fraudy, Ford Utility):**

> A photorealistic smartphone snapshot of the passenger side of an older grey Ford
> SUV/utility vehicle. A long horizontal scrape and shallow dents run along the
> rear passenger door and rear quarter panel; the passenger-side wing mirror is
> snapped off and hanging by its wires. Narrow city street, parked van visible
> behind, daytime overcast light, slightly off-angle handheld shot, no people, no
> text. Damage is consistent with a real sideswipe of a parked vehicle.

**Damage photo — Case C (clear fraud, Chevrolet Utility):**

> A photorealistic smartphone snapshot of the front-driver corner of a high-end
> seven-year-old Chevrolet SUV/utility vehicle. Scuffed bumper and a modest dent
> on the front-driver corner with light grey concrete transfer — the visible
> damage looks fairly minor and superficial. Urban roadside, daytime, slightly
> off-angle handheld shot, no people, no text. (Talking point: the photo shows
> only light surface damage, yet the file carries 6+ supplements and extensive
> underbody repairs — the visual/billing mismatch is a fraud signal.)

## Reset between demos

```bash
# Optional: reseed the local database to clear demo claims.
cds deploy --to sqlite
```

Use [`./monitor.http`](./monitor.http) to query claims, predictions and
evaluations over OData while presenting.
