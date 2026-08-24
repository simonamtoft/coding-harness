# Claude Code

My personal preferences for working with Claude Code as a consultant across many projects, each with different codebases, programming languages, infrastructure, etc.

## Skill conventions

- **Invocation class.** Reactive diagnostics and primitives that other skills call are model-invokable; heavyweight, deliberate operations set `disable-model-invocation: true` (slash-invoked only).
- **Descriptions open with "Use when…".** The description is the only thing the model matches on for auto-invocation, so lead with the trigger.

## Random theme on `claude` launch

Lives in `~/.zshrc` (outside this repo). Picks a random theme from `themes/` and rewrites `settings.json` before exec'ing `claude`:

```bash
claude() {
  local themes=(dd-blue dd-orange dd-purple dd-cyan dd-pink dd-green)
  local pick=${themes[$((RANDOM % ${#themes[@]} + 1))]}
  local settings="$HOME/.claude/settings.json"
  local tmp
  tmp=$(mktemp)
  jq --arg t "custom:$pick" '.theme = $t' "$settings" > "$tmp" && cat "$tmp" > "$settings"
  rm -f "$tmp"
  command claude "$@"
}
```

Only fires for terminal `claude` launches.

**`cat "$tmp" > "$settings"`, never `mv "$tmp" "$settings"`.** `~/.claude/settings.json` is a symlink into this repo. `mv` onto a symlink path *replaces the symlink* with a regular file rather than writing through it, so the first launch would silently decouple settings from version control — and every later `link.sh` run without `--force` would then refuse to proceed. Redirection writes through the link and keeps `theme` tracked, at the cost of a one-line dirty diff after each launch.

## Resources

- [(GitHub) Matt Pocock Engineering skills](https://github.com/mattpocock/skills/tree/main/skills/engineering)
- [(GitHub) Antrhopic PR review toolkit](https://github.com/anthropics/claude-code/tree/main/plugins/pr-review-toolkit)
- [(GitHub) Ponytail Skill](https://github.com/DietrichGebert/ponytail)
- [(YouTube) Kun Chen L8 Principal's Agentic Engineering Workflow](https://youtu.be/iQyg-KypKAA?si=Pl0RjFkDXqMqeP6C)
- [(Article) Show-me skill](https://www.linkedin.com/pulse/show-me-coding-agent-skill-compact-visual-dexter-horthy-w5yac/)