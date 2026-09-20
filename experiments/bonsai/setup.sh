#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || { echo 'Requires Apple Silicon macOS' >&2; exit 1; }

# Bonsai-demo c398c6eeef7533dd9398682cc1297e33670df0cd pins this runtime.
release=prism-b10683-d8f26ee
archive="llama-${release}-bin-macos-arm64.tar.gz"
revision=6ed5e12bf84b7a63069882c91dd9e9218647d17b
model=Ternary-Bonsai-2-27B-PQ2_0.gguf
mkdir -p local/downloads local/models local/logs

fetch() {
    local url=$1 path=$2 checksum=$3
    if [[ ! -f "$path" ]]; then
        curl --fail --location --retry 3 --connect-timeout 30 --continue-at - \
            "$url" --output "$path.part"
        echo "$checksum  $path.part" | shasum -a 256 --check
        mv "$path.part" "$path"
    else
        echo "$checksum  $path" | shasum -a 256 --check
    fi
}

fetch "https://github.com/PrismML-Eng/llama.cpp/releases/download/$release/$archive" \
    "local/downloads/$archive" 0ae163ca2c9cce92470316ed743f76985beea4d5cf31b8dc546711cf6fc8dd35
if [[ ! -d "local/$release" ]]; then
    staging=$(mktemp -d local/.runtime.XXXXXX)
    trap 'rm -rf "$staging"' EXIT
    tar -xzf "local/downloads/$archive" -C "$staging" --strip-components=1
    mv "$staging" "local/$release"
    trap - EXIT
fi
"local/$release/llama-server" --version
fetch "https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/resolve/$revision/$model" \
    "local/models/$model" 3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1
printf 'Setup complete. Start manually with: bash experiments/bonsai/start.sh\n'
