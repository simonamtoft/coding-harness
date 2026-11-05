#!/bin/bash
set -euo pipefail
# Intentionally foreground-only; Ctrl-C stops the server. No automatic startup.
exec llama-server -hf google/gemma-4-12B-it-qat-q4_0-gguf \
    --alias gemma-4-12b --jinja -ngl 999 -c 32768 \
    --host 127.0.0.1 --port 8080
