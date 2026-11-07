#!/usr/bin/env bash
# Create the context/ layout in the current directory. Existing files are left untouched.
# Usage: init.sh   (run from the repository root)
set -euo pipefail

templates="$(cd "$(dirname "${BASH_SOURCE[0]}")/../templates" && pwd)"

mkdir -p context/sources context/meetings context/decks
for register in actions.md questions.md; do
  if [[ -e "context/$register" ]]; then
    echo "kept context/$register"
  else
    cp "$templates/$register" "context/$register"
    echo "created context/$register"
  fi
done
