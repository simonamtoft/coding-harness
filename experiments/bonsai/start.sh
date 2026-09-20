#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
# Intentionally foreground-only; Ctrl-C stops the server. No automatic startup.
exec local/prism-b10683-d8f26ee/llama-server \
    --model local/models/Ternary-Bonsai-2-27B-PQ2_0.gguf \
    --alias bonsai-2-pq2 --host 127.0.0.1 --port 18080 \
    --cors-origins http://127.0.0.1:18080 --no-webui --no-agent \
    --ctx-size 24576 --parallel 1 --n-gpu-layers 99 --flash-attn on --log-verbosity 4 \
    --jinja --reasoning-format deepseek --reasoning-budget 512 --n-predict 2048 \
    --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0
