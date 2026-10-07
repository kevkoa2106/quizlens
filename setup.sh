#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v tesseract >/dev/null; then
  echo 'Install Tesseract first (macOS: brew install tesseract).'
  exit 1
fi
if [ ! -d vendor/laya ]; then
  mkdir -p vendor
  git clone https://github.com/NandhaKishorM/laya.git vendor/laya
  git -C vendor/laya checkout "$(cat LAYA_REVISION)"
fi
if command -v uv >/dev/null; then
  uv venv --python 3.13 .venv
  uv pip install --python .venv/bin/python -r requirements.txt
else
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
