# vLLM OpenAI-compatible server image for SAP AI Core (BYOM).
#
# Based on the official vLLM OpenAI image. Adapted for AI Core/KServe:
#   - world-writable HuggingFace cache + vLLM cache dirs (AI Core runs the
#     container as an arbitrary non-root UID, so $HOME is not writable)
#   - LD_LIBRARY_PATH exported for the CUDA runtime (required by AI Core)
#   - serves the OpenAI-compatible API on :8000
#
# Build for the gpt-oss family (MXFP4, needs a recent vLLM with Hopper support)
# and gemma-3. Pin VLLM_VERSION to a tag that supports your target models.
#
# Build + push (one image serves all three models — the model is chosen per
# deployment via the ServingTemplate `modelName` parameter):
#   docker buildx build --platform linux/amd64 \
#     -t <REGISTRY>/<USER>/vllm-openai-aicore:gptoss-gemma \
#     --build-arg VLLM_VERSION=v0.10.2 byom/vllm-server --push
ARG VLLM_VERSION=latest
FROM vllm/vllm-openai:${VLLM_VERSION}

# AI Core mounts no persistent HOME; give every process writable cache dirs.
ENV HF_HOME=/hf-home \
    HUGGINGFACE_HUB_CACHE=/hf-home \
    XDG_CACHE_HOME=/hf-home/.cache \
    VLLM_CACHE_ROOT=/hf-home/.cache/vllm \
    OUTLINES_CACHE_DIR=/hf-home/.cache/outlines \
    NUMBA_CACHE_DIR=/hf-home/.cache/numba \
    LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/nvidia/lib:/usr/local/nvidia/lib64

# Create the writable tree and open permissions for the arbitrary runtime UID.
RUN mkdir -p /hf-home/.cache/vllm /hf-home/.cache/outlines /hf-home/.cache/numba /nonexistent \
    && chmod -R 777 /hf-home /nonexistent

# The official image already ENTRYPOINTs the OpenAI API server; AI Core's
# ServingTemplate overrides command/args, so we only need a sane default here.
EXPOSE 8000
ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server", "--port", "8000"]
