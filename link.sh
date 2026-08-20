#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
backup_dir="$HOME/.coding-harness-backups/$(date +%Y%m%d-%H%M%S)"
force=false

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--force]

Link the canonical coding-harness resources into ~/.pi and ~/.claude.
Existing paths are refused unless --force is supplied. Forced replacements
are moved to ~/.coding-harness-backups/<timestamp> before linking.
USAGE
}

case "${1:-}" in
  "") ;;
  --force) force=true ;;
  -h|--help) usage; exit 0 ;;
  *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
esac

links=(
  "$repo_dir/pi/agent/AGENTS.md|$HOME/.pi/agent/AGENTS.md"
  "$repo_dir/pi/agent/APPEND_SYSTEM.md|$HOME/.pi/agent/APPEND_SYSTEM.md"
  "$repo_dir/pi/agent/mcp.json|$HOME/.pi/agent/mcp.json"
  "$repo_dir/pi/agent/models.json|$HOME/.pi/agent/models.json"
  "$repo_dir/pi/agent/agents|$HOME/.pi/agent/agents"
  "$repo_dir/pi/agent/extensions|$HOME/.pi/agent/extensions"
  "$repo_dir/pi/agent/prompts|$HOME/.pi/agent/prompts"
  "$repo_dir/claude/CLAUDE.md|$HOME/.claude/CLAUDE.md"
  "$repo_dir/claude/settings.json|$HOME/.claude/settings.json"
  "$repo_dir/claude/hooks|$HOME/.claude/hooks"
  "$repo_dir/claude/skills|$HOME/.claude/skills"
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
