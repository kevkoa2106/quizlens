#!/bin/sh
set -eu
cd "$(dirname "$0")"
export HF_HOME="$PWD/.cache/huggingface"
export TORCH_HOME="$PWD/.cache/torch"
export TOKENIZERS_PARALLELISM=false
exec .venv/bin/python -m backend.server
