#!/usr/bin/env bash
set -euo pipefail

DATE=$(date "+%Y-%m-%d %A")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "not a git repo")
CWD=$(pwd)

OUTPUT="Date: ${DATE} Directory: ${CWD} Branch: ${BRANCH}"

if command -v gh &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
  PRS=$(gh pr list --head "${BRANCH}" --json number,title,url,state \
    --jq '.[] | "#\(.number) [\(.state)] — \(.title)  \(.url)"' 2>/dev/null || echo "")
  if [ -n "${PRS}" ]; then
    OUTPUT="${OUTPUT} PRs on this branch: ${PRS}"
  else
    OUTPUT="${OUTPUT} PRs: none open on this branch"
  fi
fi

jq -n --arg ctx "${OUTPUT}" \
  '{
    "systemMessage": $ctx,
    "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": $ctx}
  }'
