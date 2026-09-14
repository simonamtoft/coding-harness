# coding-harness

Canonical, version-controlled setup for my coding agents. The repository keeps
user-authored resources together while leaving credentials, sessions, caches,
installed packages, and other runtime state in their native harness
directories.

## Install links

```sh
~/coding-harness/link.sh --force
```

Without `--force`, the script refuses to replace any existing path. Forced
replacements are moved to `~/.coding-harness-backups/<timestamp>` first.

Run the script again after cloning or pulling this repository. It is safe to
run repeatedly; already-correct links are left untouched.

## Pi packages

`pi/agent/packages.txt` records the Pi packages this setup expects:

| Package | Source |
| --- | --- |
| [pi-worktree-agents](https://github.com/simonamtoft/pi-worktree-agents) | `git:github.com/simonamtoft/pi-worktree-agents` |
| [pi-status-footer](https://github.com/simonamtoft/pi-status-footer) | `git:github.com/simonamtoft/pi-status-footer` |

Install them with:

```sh
~/coding-harness/link.sh --packages
```

This runs `pi install` per entry, which writes the `packages` array in the
local `~/.pi/agent/settings.json`. Entries already installed are skipped.

When developing one of the plugins, point its settings entry at the local
checkout instead (for example `../../projects/pi-worktree-agents`, relative to
`~/.pi/agent`). The install step recognises a checkout by directory name and
leaves the override in place.

## Layout

- `shared/`: the common `AGENTS.md`, skills, and command-safety/read-routing regression contracts consumed by both harnesses.
- `pi/agent/`: Pi instructions, extensions, agents, prompts, and the
  `packages.txt` manifest. Provider/model configuration is local-only and
  intentionally ignored by Git.
- `DECISIONS.md` and `decisions/`: the decision ledger — approaches this
  repository rejected or reversed, standing constraints, and rationale the code
  does not carry. `DECISIONS.md` is the index and entry format; each area keeps
  its own file under `decisions/` so agents read only the area they touch, and
  append to it when a direction is refused.

The Pi sandbox extension is enabled automatically from `pi/agent/extensions/`.
It hard-denies the high-risk Bash commands in `shared/command-safety.tsv` (such
as Git force-push, destructive Git rewrites, `sudo`, pipe-to-shell execution,
and unsafe deletion), then limits model filesystem tools to the session's current directory, while also
providing a private mode-0700 workspace under the process temp directory for
scratch artifacts. Sessions started in this harness or `~/pi-plugins` may also
edit the user-owned plugin checkouts under `~/pi-plugins`. Delivered reports and
handoffs in retained private session
workspaces stay readable, while other retained scratch content prompts and
writes remain scoped to the current session. Reads elsewhere prompt, apart from
direct reads in the canonical shared tree (including installed Pi skills that
resolve there) and read-tool access to installed Volta package content and
Playwright's managed browser cache. Sessions started at the canonical checkout
root also get read-tool access to `~/.pi/agent/sessions` and a narrowly permitted
read-only [session-history discovery helper](pi/agent/extensions/sandbox/README.md#session-history-discovery);
transcript writes and general Bash access remain blocked.
Recursive tools do not receive the shared-tree exception. The sandbox follows
symlinks before checking and hard-denies common secret paths
everywhere. Agent control files and plugin source are write-protected unless Pi
was started inside this canonical `coding-harness` checkout. Session transcripts
and local Pi configuration are normalized to owner-only permissions at startup.
Its Bash protections are lexical checks, so they catch explicit paths and known
high-risk commands but do not constitute an OS-enforced sandbox; use a container
or VM when that boundary is required. Quoted bodies passed to inline interpreter
evaluation are treated as code rather than path arguments, so they are not
inspected for paths, though secret literals inside them are still denied.
- `claude/`: Claude hooks, settings, agents, statusline, and themes.

Only genuinely harness-neutral resources live in `shared/`, and they are the
single source of truth for both harnesses:

```text
~/coding-harness/shared/AGENTS.md -> ~/.pi/agent/AGENTS.md + ~/.claude/CLAUDE.md
~/coding-harness/shared/skills    -> ~/.pi/agent/skills   + ~/.claude/skills
~/coding-harness/shared/command-safety.tsv -> shared command-deny regression contract
```

Everything else is harness-specific, because the two harnesses disagree on
format or capability:

| Resource | Why it is not shared |
| --- | --- |
| `pi/agent/prompts/` | Pi reads `prompts/`; Claude Code reads `commands/`. `review.md` also calls `review_changes`, a Pi extension tool. |
| `pi/agent/agents/` | Agent frontmatter differs per harness (`model` and `tools` vocabularies). The reviewers are Pi-only because `review_changes` drives them. |
| `claude/agents/` | A Claude-shaped `presenter` so the shared `present` skill works in both harnesses. |

The `present` and `swarm` skills stay shared: their workflows are
harness-neutral, and only the delegation call differs (Pi's `subagent` tool vs
Claude Code's `Task` tool). Both variants are documented in each skill; Pi uses
the standard `/skill:swarm` command rather than a separate prompt alias.

Per-project verifiers are harness-neutral too. Pi's `verify-turn` extension and
Claude's `verify-turn.sh` Stop hook both resolve `.agent/verify.sh`, then a
`verify` task in a `Taskfile`, so a repo wires one verifier for both. Pi discovers
and executes these repository-controlled commands only after Pi project trust
and a separate content-bound verifier approval for the current session.

Pi's optional fast diagnostics are also project-owned: an executable
`.agent/diagnostics.sh` receives the changed path after each successful Pi edit or
write and reports advisory feedback. It is separate from the full end-of-turn
verifier, requires a session-scoped content-bound approval, and is documented in
`pi/agent/extensions/diagnostics/README.md`.

Pi's `~/.pi/agent/settings.json`, `~/.pi/agent/models.json`, and
`~/.pi/agent/subagents.json` remain local. The settings file contains package
paths relative to the native Pi directory, the model catalog points at
environment-specific providers, and `subagents.json` optionally maps agent
names to machine-specific `provider/model` values. Authentication and generated
state are also intentionally not versioned.

## Adding the Hetzner Inference API

Because `models.json` is local, providers are added per machine. To expose
Hetzner Inference models in Pi:

1. Create a token at <https://experiments.hetzner.com>: log in with your
   Hetzner account, open **APPS → Inference**, and click **Create API Token**
   (top right). Then export it where Pi runs, e.g. in your shell rc:

   ```sh
   export HETZNER_API_KEY=...
   ```

2. Add a `hetzner` entry under the top-level `providers` object in
   `~/.pi/agent/models.json` (merge with an existing `providers` object if
   present):

   ```json
   "hetzner": {
     "baseUrl": "https://inference.hetzner.com/api/v1",
     "api": "openai-completions",
     "apiKey": "$HETZNER_API_KEY",
     "models": [
       { "id": "Qwen/Qwen3.6-35B-A3B-FP8", "contextWindow": 262144 },
       { "id": "Qwen3.8-27B", "contextWindow": 262144 }
     ]
   }
   ```

   Useful optional per-model fields: `name`, `maxTokens` (default 16384),
   `reasoning`, `input`, and `cost`.

3. Verify with `pi --list-models`, or open `/model` in a session — the file
   reloads when the dialog opens, so no restart is needed. The models stay
   hidden from `/model` until `HETZNER_API_KEY` is set in Pi's environment.

If the endpoint rejects requests, add provider-level `compat` flags; for
example, OpenAI-compatible servers that do not understand the `developer`
role need `"compat": { "supportsDeveloperRole": false }`. Pi's `models.md`
doc has the full provider and model schema.

## Session context hygiene

Prefer one focused task per session. In Pi, use `/ctx-monitor` to inspect which
sources are consuming the context window. When a session grows large, use
`/handoff` to preserve its decisions and state, then continue in a fresh
session. Reloading `AGENTS.md` can restore attention to instructions
temporarily, but it does not remove the accumulated context.

### Bulk-read routing

Large reference reads can be delegated without loading their contents into the
parent conversation. Pi's `read-routing` extension and Claude's
`route-bulk-read.py` PreToolUse hook redirect broad `Read` calls for regular files
larger than 16 KiB to the shared `bulk-read` skill. The parent supplies explicit paths and a
question; the read-only worker returns findings, source locations, and coverage
gaps, targeting at most 600 words. Pi resolves the worker's configured canonical
or local provider/model pin independently of the parent, passing both values
explicitly to the child; an unpinned worker inherits the parent's exact model.
This is predictable routing, not a same-provider data-egress boundary: the child
fails instead of silently switching providers when its selected provider/model is
unavailable. Claude uses Haiku; use bounded direct reads when that provider is not
permitted for the source.

Explicit limits of 1–350 lines remain available for original-source inspection;
an offset alone or an oversized limit does not bypass routing. Read complete
source in chunks when reasoning requires it. Governing Markdown stays directly
readable: AGENTS/CLAUDE/SYSTEM instructions, SKILL files, CONTEXT files, DECISIONS,
Markdown below skills/agents/adr/adrs/decisions, and Claude rules. Native image,
PDF, and notebook inputs also stay on the direct path. These exemptions never
grant filesystem permission or weaken secret checks.

The guards compare file size against one threshold and never open or return file
contents. Size tracks token cost far more closely than line count does: measured
across prose and code, characters per token stayed near 3.6 while tokens per line
varied fourfold. The 16 KiB gate sits inside the measured delegation break-even
band; see the [routing README](pi/agent/extensions/read-routing/README.md) for the
numbers. Bash output limiting remains independent. The guards do not
intercept Bash, search output, or files already injected into context. Worker calls are exempt
from cost routing: Pi children load only the sandbox extension; Claude uses the
hook's `agent_id` to distinguish children from top-level custom agents. No
routing-specific toggle, full-read exemption state, or automatic writer is added.

Existing directory links deploy all resources without changing `link.sh`.
Reload Pi with `/reload` and start a new Claude session to load the new resources.
Claude requires `python3`, already used by other hooks. Run the shared policy
fixtures through both implementations:

```sh
bun test pi/agent/extensions
PYTHONDONTWRITEBYTECODE=1 python3 claude/hooks/test/read-routing-test.py
```

This is a cost-routing pilot, not a claimed percentage saving. Compare parent
context, total parent-plus-worker cost (including cache effects), latency, missed
facts, and subsequent rereads on representative tasks before tuning thresholds.
See the [routing diagrams and evaluation guide](pi/agent/extensions/read-routing/README.md)
for provisioning, current limitations, and session-probe evidence.
A worker failure or permission denial falls back to permitted bounded direct
reads, not a silent model upgrade or security bypass.

## Resources

- https://github.com/cursor/plugins/tree/main/pstack/skills/
- https://github.com/mattpocock/skills/tree/main/skills
- https://fabiensanglard.net/agent.md/index.html
- https://github.com/amosblomqvist/pi-config/tree/main
