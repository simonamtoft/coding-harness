#!/usr/bin/env bash
# Temporary diagnostic launcher for Paseo's Pi agents (enable with PI_COMMAND; see README).
#
# Paseo starts `pi`, the Volta shim, which reports a signal-killed Node child as
# "exit code 1, signal null". This launcher runs Pi's Node entry directly, records how
# the process ended plus periodic memory and process-list samples, and re-raises the
# terminating signal so Paseo logs the real one.
# shortcut: diagnostic only; remove once the unexplained Pi SIGKILL under Paseo is identified.
set -u

volta_home="${VOLTA_HOME:-$HOME/.volta}"
pi_cli="$volta_home/tools/image/packages/@earendil-works/pi-coding-agent/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
log_dir="${PI_DIAGNOSTIC_LOG_DIR:-$HOME/.paseo/pi-diagnostic}"
sample_seconds="${PI_DIAGNOSTIC_SAMPLE_SECONDS:-5}"

node="$(volta which node 2>/dev/null)" || node=""
if [[ -z "$node" || ! -x "$node" || ! -f "$pi_cli" ]]; then
  echo "pi-diagnostic: cannot resolve node ($node) or Pi CLI ($pi_cli)" >&2
  exit 127
fi

mkdir -p "$log_dir"
log="$log_dir/$(date +%Y%m%dT%H%M%S)-$$.log"
snapshot="$log.ps"
note() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$log"; }

# Background jobs in a non-interactive shell read /dev/null unless stdin is passed explicitly.
exec 3<&0
"$node" "$pi_cli" "$@" <&3 3<&- &
child=$!
exec 3<&-
note "start wrapper=$$ node=$child cwd=$PWD args=$*"

for sig in TERM HUP INT; do
  trap "note 'forwarding SIG$sig'; kill -s $sig $child 2>/dev/null" "$sig"
done

(
  while kill -0 "$child" 2>/dev/null; do
    note "sample rss_kb=$(ps -o rss= -p "$child" | tr -d ' ') load=\"$(sysctl -n vm.loadavg)\""
    ps -axo pid,ppid,pgid,etime,rss,command >"$snapshot.tmp" 2>/dev/null && mv "$snapshot.tmp" "$snapshot"
    sleep "$sample_seconds"
  done
) &
sampler=$!

# `wait` returns early when a trapped signal arrives; keep waiting until the child is gone.
while :; do
  wait "$child"
  status=$?
  kill -0 "$child" 2>/dev/null || break
done
kill "$sampler" 2>/dev/null

if (( status > 128 )); then
  signal="$(kill -l $((status - 128)) 2>/dev/null || echo "$((status - 128))")"
  note "end node=$child signal=SIG$signal status=$status (last process list: $snapshot)"
  trap - TERM HUP INT
  kill -s "$signal" $$
  exit "$status"
fi

note "end node=$child exit=$status"
rm -f "$snapshot"
exit "$status"
