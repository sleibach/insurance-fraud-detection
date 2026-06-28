---
title: BYOM Kit — Self-Hosted Open-Source LLMs on SAP AI Core
summary: Turnkey artifacts + automation to deploy gpt-oss-120b, gpt-oss-20b, and gemma-3-27b as self-hosted vLLM deployments on SAP AI Core (BYOM), and wire them into the fraud-detection open-source evaluate track.
keywords: [BYOM, vLLM, gpt-oss-120b, gpt-oss-20b, gemma-3-27b, SAP AI Core, ServingTemplate, docker registry secret, GitOps, instance type, scale-to-zero]
audience: [developers, devops, AI agents]
related:
  - ../docs/ai/open-source-llm-byom.md
  - ../scripts/byom-onboard.ts
  - ../scripts/deploy-oss-model.ts
last_updated: 2026-06-28
---

# BYOM Kit — Self-Hosted Open-Source LLMs on SAP AI Core

**TL;DR** — Everything needed to run **gpt-oss-120b**, **gpt-oss-20b**, and **gemma-3-27b** as self-hosted **vLLM** deployments on SAP AI Core (data stays in SAP, AWS Frankfurt), then use them as the pipeline's open-source evaluate track. This is real GPU self-hosting and has hard prerequisites you must supply: a container registry, a git repo AI Core can sync, and GPU budget.

## What's in this kit

| File | Purpose |
|------|---------|
| `vllm-server/Dockerfile` | vLLM OpenAI-compatible server image, adapted for AI Core/KServe (writable caches, CUDA libs, port 8000). |
| `build-and-push.sh` | Build + push that image to your registry (`linux/amd64`). |
| `serving-templates/vllm-template.yaml` | AI Core `ServingTemplate` (scenario `aicore-opensource`, executable `aicore-opensource-vllm`), parameterized + scale-to-zero. |
| `../scripts/byom-onboard.ts` | Registers the docker secret + git repo + application in AI Core. |
| `../scripts/deploy-oss-model.ts` | Creates the configuration + deployment per model and polls to RUNNING. |
| `../scripts/inspect-aicore.ts` | Read-only check of scenarios / deployments / instance types. |

## Prerequisites you must provide

The default path uses the **public `vllm/vllm-openai` image** (caches redirected to `/tmp`), so **no Docker build/push is required**. You still need:

1. **Docker Hub login** for a *pull* secret (created in AI Core via the service-key binding) to avoid anonymous pull rate-limits on the ~10 GB vLLM image. Set `BYOM_DOCKER_USER/PASSWORD`. *(Optional: build a custom image with `byom/vllm-server/Dockerfile` + `build-and-push.sh` and set `BYOM_IMAGE`.)*
2. **Git repository** reachable by AI Core, containing `byom/serving-templates/` — your repo `github.com/sleibach/insurance-fraud-detection` works once pushed. Set `BYOM_GIT_URL/USER/TOKEN`.
3. **GPU instance types** on the **extended** plan — tenant-specific ids for H100 80 GB (gpt-oss-120b), L4 24 GB (gpt-oss-20b), L40S 48 GB (gemma-3-27b). Found in **SAP AI Launchpad** (deployment configuration → instance type) or SAP Note 3660109. Set `OSS_INSTANCE_120B/20B/GEMMA`.
4. **HuggingFace token** + accepted license for the gated `google/gemma-3-27b-it`. Set `HF_TOKEN`.
5. **Budget approval** — self-hosted GPU bills node-hours while RUNNING (~€2.5–3.5/GPU-hr). Scale-to-zero (`minReplicas: 0`) keeps idle cost at zero, with a cold start on first call.

## End-to-end steps

```bash
# 1) Onboard docker (pull) secret + git repo + application (one-time)
export BYOM_DOCKER_SERVER='https://index.docker.io/v1/'
export BYOM_DOCKER_USER='<dockerhub-user>'  BYOM_DOCKER_PASSWORD='<dockerhub-token>'  BYOM_DOCKER_SECRET='byom-docker-secret'
export BYOM_GIT_URL='https://github.com/sleibach/insurance-fraud-detection'  BYOM_GIT_USER='<gh-user>'  BYOM_GIT_TOKEN='<gh-PAT>'
cds bind --exec --profile hybrid -- npx tsx scripts/byom-onboard.ts
# wait a few minutes for the app to sync; confirm scenario 'aicore-opensource' appears
cds bind --exec --profile hybrid -- npx tsx scripts/inspect-aicore.ts

# 2) Deploy each model (public vLLM image, scale-to-zero). Provide instance types + HF token.
export BYOM_DOCKER_SECRET='byom-docker-secret'
export OSS_INSTANCE_120B='<h100-id>'  OSS_INSTANCE_20B='<l4-id>'  OSS_INSTANCE_GEMMA='<l40s-id>'
export HF_TOKEN='<hf-token>'
npm run deploy:oss-model -- gpt-oss-120b --wait
npm run deploy:oss-model -- gpt-oss-20b  --wait
npm run deploy:oss-model -- gemma-3-27b  --wait

# 3) Point the pipeline at the deployments (printed by step 2) and run E2E
export OSS_GPT_OSS_120B_URL='https://<deploymentUrl>'
export OSS_LLM_RESOURCE_GROUP='default'
npm run test:e2e
```

## Per-model GPU sizing (defaults in deploy-oss-model.ts)

| Model | HF id | GPU | Notes |
|-------|-------|-----|-------|
| gpt-oss-120b | `openai/gpt-oss-120b` | H100 80 GB | native MXFP4, tensor-parallel 1 |
| gpt-oss-20b | `openai/gpt-oss-20b` | L4 24 GB | MXFP4 ~16 GB |
| gemma-3-27b | `google/gemma-3-27b-it` | L40S 48 GB | `--quantization fp8` (bf16 ~54 GB won't fit 48 GB); gated → `HF_TOKEN` |

See [../docs/ai/open-source-llm-byom.md](../docs/ai/open-source-llm-byom.md) for infra/cost background and the runtime call path.
