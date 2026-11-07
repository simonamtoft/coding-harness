# Repository operating context

This repository is the canonical, version-controlled source for the user's Pi and Claude coding-agent setup. `link.sh` deploys it into each harness's native directory; credentials and runtime state remain local. `README.md` is the human setup guide and design explanation. Keep this file to agent-facing operating constraints.

## Repository map

```text
AGENTS.md                         repository-wide ownership and verification rules
shared/
  AGENTS.md                       global runtime instructions linked into both harnesses
  skills/                         harness-neutral skills; see skills/AGENTS.md when authoring one
pi/agent/
  agents/                         canonical Pi subagent definitions; see agents/AGENTS.md
  extensions/subagent/            Pi subagent runtime and validation; see subagent/AGENTS.md
  extensions/                     other Pi-only runtime extensions
  prompts/                        Pi-only slash-prompt workflows
claude/                           Claude-only runtime resources (parked, frozen; OWN-16)
paseo/config.json                 Paseo daemon configuration, linked to ~/.paseo/config.json
paseo/pi-diagnostic.sh            temporary opt-in Pi launcher for diagnosing Pi deaths under Paseo
paseo/pi-diagnostic.launchagent.plist  login agent that re-applies PI_COMMAND for that launcher
paseo/box/                        isolated Paseo + Pi container on Colima; see paseo/box/README.md
paseo.json                        Paseo project config: worktree setup symlinks backlog/
probes/                           manual instruction-behavior evaluation; see probes/AGENTS.md
local-models/                      local-model playgrounds (Bonsai, Gemma); decisions in decisions/local-models.md
link.sh                           deployment topology, Pi package installation, hooks path
.agent/verify.sh                  offline repository verifier (no model calls)
.githooks/pre-commit              runs scripts/pi-load-check.ts for Pi runtime changes
README.md                         human-facing setup and architecture guide
PAPERCUTS.md                      untracked harness-friction log written by the report_papercut Pi tool
DECISIONS.md + decisions/         durable decision ledger
```

Route a change to the narrowest owner. `shared/` is only for one implementation that both harnesses can consume; divergent syntax, tools, or runtime behavior belongs under its harness. Do not put repository-maintenance guidance in `shared/AGENTS.md`: it is the global instruction file installed into ordinary Pi and Claude sessions. Use the nearest nested `AGENTS.md` when changing skills, Pi agent definitions, or the subagent extension.

## Ownership and constraints

- `shared/AGENTS.md` and `shared/skills/` are only for behavior one implementation can serve to both harnesses. Keep divergent formats and capabilities in their harness directory; do not duplicate shared resources there.
- `pi/agent/` owns Pi-only instructions, agents, extensions, prompts, MCP configuration, and the package manifest.
- Keep test files out of `pi/agent/extensions/` root. Pi auto-loads every root `*.ts`; colocate tests inside extension subdirectories, where only `index.ts` is auto-discovered.
- `claude/` owns Claude-only agents, hooks, settings, statusline, and themes. The Claude harness is parked (OWN-16): do not change `claude/`, add Claude variants to shared skills, or create Claude tasks unless the user asks. Keep its files and `link.sh` entries as they are, and put harness work into Pi.
- `paseo/` owns Paseo's `config.json`, the temporary `pi-diagnostic.sh` launcher with its LaunchAgent, and the `box/` container. Keep the box's mount, credential, and network policy in `paseo/box/README.md` in step with its `compose.yaml`, `entrypoint.sh`, and `firewall.sh`. Paseo writes to it through the link, so check its diff for `daemon.auth.password` or provider `env` secrets before committing.
- `probes/` owns isolated instruction comparisons and whole-Pi-harness behavior scenarios. Runs make paid model calls, so keep the suite manual and out of automatic verification; keep `probes/results/` local and untracked.
- `local-models/` owns local-model launchers, setup notes, and measurements. For any local-model question or setup, read `decisions/local-models.md` and the existing playground READMEs first; Pi provider configuration for them stays in the untracked `~/.pi/agent/models.json`.
- Root `AGENTS.md` applies only in this repository. Preserve its generated Backlog instruction block.
- Edit canonical sources here, never their installed paths under `~/.pi` or `~/.claude`.
- `link.sh` defines link topology, Pi package installation, and this checkout's `core.hooksPath`. Preserve its refusal and backup behavior for existing targets.
- Do not commit credentials, authentication state, machine-local provider/model configuration, sessions, caches, installed packages, generated state, or local `~/.pi/agent/settings.json`, `models.json`, and `subagents.json`. Canonical built-in model defaults in `pi/agent/agents/` are the exception; local `subagents.json` overrides remain untracked.
- This repository is public. Do not commit employer- or client-confidential material: internal documents, templates, brand guidance, photographs of people, client names or data, or anything copied from client work. Keep such material in gitignored local paths or untracked local configuration, use generic placeholders in examples and tests, and ask before committing anything whose confidentiality is unclear. Infrastructure hostnames are not covered (OWN-17).
- Update `README.md` with changes to link behavior, layout, installation, or ownership boundaries.

## Inspecting Pi session history

From any Git repository, use the Pi `recent_sessions` tool (optional `limit`,
1–100; default 25) to list recent Pi sessions started in that repository.
The tool returns metadata only. Use the read tool on a returned path to inspect a
same-repository transcript; other repositories' transcripts still require
interactive approval. When Pi starts at this canonical checkout root, discover
matching transcripts across projects with:

```bash
bun pi/agent/extensions/sandbox/session-history.ts --match "playwright" --limit 25
```

Replace the topic and limit as needed (1–100). The helper searches message records,
including tool calls/results, and returns top-level sessions newest-first by start
time. Use the **read tool** on the returned paths. If a single JSONL record exceeds its
size limit, use bounded field extraction instead:

```bash
bun pi/agent/extensions/sandbox/session-history.ts --session <uuid> --record <record-id> --field message.content --offset 0 --limit 2000
```

Use the record's top-level eight-hex-digit `id`. Follow `nextOffset` until null;
select nested worker evidence with fields such as
`message.details.results.0.messages.4`. See the sandbox README for the field and
pagination contract. Do not use Bash `ls`, `find`, or
`rg` on `~/.pi/agent/sessions`: general Bash access remains blocked even though
this helper and transcript reads are permitted. A Bash denial alone does not mean
logs need exporting or permissions need changing; try this approved workflow first.
Keep reads scoped to the requested evidence and avoid exposing unrelated sensitive
transcript content. Cross-project search and extraction do not apply from other projects or checkout
subdirectories; protected paths and symlinked session-store roots remain
restricted.

## Decision ledger

`DECISIONS.md` indexes the ledger of rejected approaches, reversals, standing constraints, and rationale that the code does not carry. Entries live in per-area files under `decisions/`.

- Use the index to find the area file matching your change, read that file before proposing the change, and do not re-propose an approach an entry refuses unless its `Revisit if` condition is met. Read only the areas you touch.
- Append an entry to the matching area file when finalizing work that rejected or reversed an approach, when the user overrules a design direction, or when accepted rationale would otherwise be lost. Follow the entry format, id rule, and exclusions stated in `DECISIONS.md`.

## Verification

Run checks for the changed component:

- Link script syntax: `bash -n link.sh`
- Pi extensions: `bun test pi/agent/extensions`
- Claude Bash guard: `bash claude/hooks/test/run.sh`
- Claude verify hook: `bash claude/hooks/test/verify-turn-run.sh`
- Probe runner libraries and lifecycle (offline, fake `pi`): `bun test probes/lib probes/test`
- Pi load-check overlay: `bun test ./scripts/`

`.agent/verify.sh` runs all of these automatically. The Claude hook suites stay in it while the Claude harness is parked, so a regression in the still-linked hooks fails visibly. For a change to Pi runtime inputs, `bun scripts/pi-load-check.ts` checks without model calls that the installed harness loads; the pre-commit hook runs it too.

The probes suite is parked as work in progress (PRB-19). Do not run paid probes (`bun probes/run.ts --compare` or `--harness-mode whole`) as a verification step, and do not cite their results as evidence for a change, unless the user explicitly asks. The offline probe tests above still run. A requested paid run costs real model calls and minutes: read `probes/README.md` first, and never put it in an automatic hook.

For link-topology changes, exercise `link.sh` with an isolated temporary `HOME`; never test a forced install against the real home directory.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.51.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
