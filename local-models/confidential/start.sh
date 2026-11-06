#!/bin/bash
# Confidential mode: Pi with local Gemma, unable to reach any other network destination (see README.md).
# Paseo's pi-confidential provider runs this too and appends its own Pi arguments.
set -euo pipefail

model_port=8080
here="$(cd "$(dirname "$0")" && pwd -P)"
profile_script="$here/../../pi/agent/extensions/sandbox/confidential-profile.ts"

if [[ ! -x /usr/bin/sandbox-exec ]]; then
  echo "confidential mode: /usr/bin/sandbox-exec is missing; refusing to start Pi" >&2
  exit 1
fi
profile="$(bun "$profile_script" "$model_port")"

unset PI_COMMAND_SANDBOX
export PI_COMMAND_SANDBOX_ACTIVE=1 PI_COMMAND_SANDBOX_EGRESS=local-model
exec /usr/bin/sandbox-exec -p "$profile" pi --model local/gemma-4-12b "$@"
