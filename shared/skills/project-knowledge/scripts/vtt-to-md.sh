#!/usr/bin/env bash
# Turn a Teams WebVTT transcript into readable Markdown: one paragraph per speaker turn,
# with the turn's start time. Writes <stem>.md beside the .vtt.
# Usage: vtt-to-md.sh <transcript.vtt> [original file name]
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! -f "$1" || "$1" != *.vtt ]]; then
  echo "usage: vtt-to-md.sh <existing .vtt file> [original file name]" >&2
  exit 2
fi

source_file="$1"
original="${2:-$(basename "$source_file")}"
target="${source_file%.vtt}.md"
if [[ -e "$target" ]]; then
  echo "refusing to overwrite $target; remove it first to reconvert" >&2
  exit 1
fi

{
  printf '<!-- generated from %s (original name: %s) on %s; do not edit, reconvert instead -->\n\n' \
    "$(basename "$source_file")" "$original" "$(date +%F)"
  # Cue ids and NOTE blocks sit outside a cue's timing line, so only lines after
  # "-->" and before the next blank line are read. Teams marks speakers with <v Name>.
  tr -d '\r' < "$source_file" | awk '
    function flush() {
      if (text != "") printf "**%s** (%s): %s\n\n", (speaker == "" ? "Unknown" : speaker), start, text
      text = ""
    }
    /-->/ { in_cue = 1; cue_time = substr($1, 1, 8); cue_speaker = ""; next }
    /^[[:space:]]*$/ { in_cue = 0; next }
    !in_cue { next }
    {
      line = $0
      if (match(line, /^<v[ .][^>]*>/)) {
        tag = substr(line, 1, RLENGTH)
        sub(/^<v[^ ]* /, "", tag); sub(/>$/, "", tag)
        cue_speaker = tag
        line = substr(line, RLENGTH + 1)
      }
      gsub(/<[^>]*>/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line == "") next
      if (cue_speaker != speaker || text == "") { flush(); speaker = cue_speaker; start = cue_time; text = line }
      else text = text " " line
    }
    END { flush() }
  '
} > "$target"

turns=$(grep -c '^\*\*' "$target" || true)
echo "$target: $turns speaker turns"
