#!/bin/sh
# Start paseo-box on a checkout. See README.md.
# usage: paseo-box.sh [checkout]   (default: the Git checkout containing the current directory)
set -eu
box_dir=$(cd "$(dirname "$0")" && pwd)
harness=$(cd "$box_dir/../.." && pwd)
config_dir="$HOME/.config/paseo-box"
host_pi="$config_dir/pi"

workspace=$(git -C "${1:-.}" rev-parse --show-toplevel)
# The box mounts .git read-only, which needs a main checkout; a linked worktree's Git data lives elsewhere.
if [ ! -d "$workspace/.git" ]; then
  echo "paseo-box: $workspace is a linked worktree; start the box on its main checkout" >&2
  exit 1
fi

if ! colima status >/dev/null 2>&1; then
  echo "paseo-box: Colima is not running; start it with the mounts listed in $box_dir/README.md" >&2
  exit 1
fi

# The daemon password keeps other Mac processes off the box's port. It is kept out of the mounted
# folders, but Paseo passes it in the environment, so agents in the box can read it.
mkdir -p "$host_pi"
chmod 700 "$config_dir" "$host_pi"
if [ ! -s "$config_dir/daemon-pass" ]; then
  (umask 077 && openssl rand -hex 16 > "$config_dir/daemon-pass")
fi

# models.json and settings.json stay local to this Mac; the box reads copies refreshed on every
# start, so ~/.pi/agent itself never enters the Colima VM.
for file in models.json settings.json; do
  install -m 600 "$HOME/.pi/agent/$file" "$host_pi/$file"
done

PASEO_BOX_PASSWORD=$(cat "$config_dir/daemon-pass")
export PASEO_BOX_PASSWORD PASEO_BOX_HARNESS="$harness" PASEO_BOX_HOST_PI="$host_pi" PASEO_BOX_WORKSPACE="$workspace"
docker --context colima compose --project-directory "$box_dir" up -d --build
echo "paseo-box: serving $workspace on 127.0.0.1:${PASEO_BOX_PORT:-6768} (password in $config_dir/daemon-pass)"
