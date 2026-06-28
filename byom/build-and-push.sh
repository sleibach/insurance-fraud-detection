#!/usr/bin/env bash
# Build and push the vLLM OpenAI server image used by all three BYOM models.
# One image serves gpt-oss-120b / gpt-oss-20b / gemma-3-27b — the model is
# chosen per AI Core deployment via the ServingTemplate `modelName` parameter.
#
# Usage:
#   export BYOM_IMAGE='docker.io/<USER>/vllm-openai-aicore:gptoss-gemma'
#   export VLLM_VERSION='v0.10.2'   # a tag that supports gpt-oss (MXFP4) + gemma-3
#   ./byom/build-and-push.sh
#
# AI Core runs on linux/amd64 — always build for that platform.
set -euo pipefail

: "${BYOM_IMAGE:?Set BYOM_IMAGE to your registry image, e.g. docker.io/<user>/vllm-openai-aicore:gptoss-gemma}"
VLLM_VERSION="${VLLM_VERSION:-latest}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building ${BYOM_IMAGE} (vLLM ${VLLM_VERSION}) for linux/amd64..."
docker buildx build \
  --platform linux/amd64 \
  --build-arg "VLLM_VERSION=${VLLM_VERSION}" \
  -t "${BYOM_IMAGE}" \
  "${HERE}/vllm-server" \
  --push

echo "Pushed ${BYOM_IMAGE}"
