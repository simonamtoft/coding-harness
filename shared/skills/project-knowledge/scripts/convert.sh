#!/usr/bin/env bash
# Convert one office or PDF file to Markdown beside it: <stem>.md.
# Usage: convert.sh <file.(pptx|docx|xlsx|xls|pdf)> [original file name]
set -euo pipefail

# Pinned so conversions are reproducible; bump deliberately after check-packages.
MARKITDOWN="markitdown[docx,pptx,xlsx,xls,pdf]==0.1.9"

if [[ $# -lt 1 || $# -gt 2 || ! -f "$1" ]]; then
  echo "usage: convert.sh <existing file> [original file name]" >&2
  exit 2
fi

source_file="$1"
original="${2:-$(basename "$source_file")}"
target="${source_file%.*}.md"
if [[ -e "$target" ]]; then
  echo "refusing to overwrite $target; remove it first to reconvert" >&2
  exit 1
fi

body="$(uv run -q --no-project --with "$MARKITDOWN" markitdown "$source_file")"
{
  printf '<!-- generated from %s (original name: %s) with %s on %s; do not edit, reconvert instead -->\n\n' \
    "$(basename "$source_file")" "$original" "$MARKITDOWN" "$(date +%F)"
  printf '%s\n' "$body"
} > "$target"

words=$(printf '%s' "$body" | wc -w | tr -d ' ')
echo "$target: $words words"
if [[ "$words" -lt 20 ]]; then
  echo "warning: almost no text extracted; the file may be scanned images or charts only" >&2
fi
