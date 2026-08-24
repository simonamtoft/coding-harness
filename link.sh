#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
backup_dir="$HOME/.coding-harness-backups/$(date +%Y%m%d-%H%M%S)"
force=false
install_packages=false
packages_manifest="$repo_dir/pi/agent/packages.txt"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--force] [--packages]

Link the canonical coding-harness resources into ~/.pi and ~/.claude.
Existing paths are refused unless --force is supplied. Forced replacements
are moved to ~/.coding-harness-backups/<timestamp> before linking.

--packages also installs the Pi packages listed in pi/agent/packages.txt,
which writes to the local ~/.pi/agent/settings.json.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    --packages) install_packages=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

links=(
  "$repo_dir/shared/AGENTS.md|$HOME/.pi/agent/AGENTS.md"
  "$repo_dir/pi/agent/APPEND_SYSTEM.md|$HOME/.pi/agent/APPEND_SYSTEM.md"
  "$repo_dir/pi/agent/mcp.json|$HOME/.pi/agent/mcp.json"
  "$repo_dir/pi/agent/agents|$HOME/.pi/agent/agents"
  "$repo_dir/pi/agent/extensions|$HOME/.pi/agent/extensions"
  "$repo_dir/pi/agent/prompts|$HOME/.pi/agent/prompts"
  "$repo_dir/shared/skills|$HOME/.pi/agent/skills"
  "$repo_dir/claude/agents|$HOME/.claude/agents"
  "$repo_dir/shared/AGENTS.md|$HOME/.claude/CLAUDE.md"
  "$repo_dir/claude/settings.json|$HOME/.claude/settings.json"
  "$repo_dir/claude/hooks|$HOME/.claude/hooks"
  "$repo_dir/shared/skills|$HOME/.claude/skills"
  "$repo_dir/claude/statusline-command.sh|$HOME/.claude/statusline-command.sh"
  "$repo_dir/claude/themes|$HOME/.claude/themes"
)

for entry in "${links[@]}"; do
  source=${entry%%|*}
  target=${entry#*|}
  if [[ ! -e "$source" ]]; then
    echo "Missing canonical path: $source" >&2
    exit 1
  fi
  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    continue
  fi
  if [[ ( -e "$target" || -L "$target" ) && "$force" != true ]]; then
    echo "Refusing existing path: $target (use --force to back it up and replace it)" >&2
    exit 1
  fi
done

for entry in "${links[@]}"; do
  source=${entry%%|*}
  target=${entry#*|}
  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    continue
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    backup_target="$backup_dir${target#$HOME}"
    mkdir -p "$(dirname "$backup_target")"
    mv "$target" "$backup_target"
    echo "Backed up $target -> $backup_target"
  fi
  mkdir -p "$(dirname "$target")"
  ln -s "$source" "$target"
  echo "Linked $target -> $source"
done

[[ "$install_packages" == true ]] || exit 0

if ! command -v pi >/dev/null 2>&1; then
  echo "Cannot install packages: pi is not on PATH" >&2
  exit 1
fi

if [[ ! -f "$packages_manifest" ]]; then
  echo "Missing package manifest: $packages_manifest" >&2
  exit 1
fi

installed=$(pi list 2>/dev/null || true)
installed_specs=$(printf '%s\n' "$installed" | awk 'NF {print $1}')
# Resolved checkout names, so a local-path override of a listed package is kept.
installed_names=$(printf '%s\n' "$installed" | awk -F/ 'NF > 1 {print $NF}')

while IFS= read -r spec || [[ -n "$spec" ]]; do
  spec=${spec%%#*}
  spec=${spec// /}
  [[ -n "$spec" ]] || continue

  name=${spec#*:}
  name=${name##*/}
  name=${name%%@*}

  if grep -qxF "$spec" <<<"$installed_specs"; then
    echo "Already installed: $spec"
    continue
  fi
  if grep -qxF "$name" <<<"$installed_names"; then
    echo "Skipping $spec (local override already installed as $name)"
    continue
  fi
  pi install "$spec"
done <"$packages_manifest"
