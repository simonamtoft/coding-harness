---
name: project-flow-verification
description: Create or maintain a project-local skill that launches an app, drives real user flows, captures observable evidence and side effects, and cleans up only what it owns. Use when a project needs a reusable live UI, CLI, TUI, or service verification workflow, or when auditing such a workflow for drift.
disable-model-invocation: true
---

# Project-flow verification

Use this explicit workflow to create or maintain one project-local verification artifact for a repository's primary user surface. It complements, never replaces, deterministic checks: `wire-up-verifier` owns `verify-turn`'s automatic typecheck, lint, and test command.

Choose one mode:

- **Create:** no suitable project-local live-flow verification skill exists.
- **Maintain:** audit, update, or investigate drift in one existing project-local live-flow verification skill.

The artifact is `.agents/skills/verify-<app>/`, containing `SKILL.md`, `features/`, and only helpers it owns. Pi discovers this location in trusted projects. Use an existing skill location only when it is already Pi-compatible; never create a parallel artifact.

## Lifecycle rules

- Drive the real user surface, not internal setters, test-only endpoints, or implementation details. Mock only an external boundary already isolated by production design.
- The coordinator owns writes, live instances, app state, evidence, and cleanup. Independent read-only source research may run in parallel, but never drives the app or edits files.
- Drive a long-lived server or UI serially. Give each short-lived CLI or TUI drive a fresh isolated session. Never double-drive shared state.
- Run the artifact's doctor before its first drive and after a failed or surprising drive. If doctor cannot identify the bad state, reset to known state or relaunch; never continue on hope.
- Capture evidence as produced. Keep it outside the repository unless an existing ignored evidence location is suitable; use the session temporary workspace for ad hoc evidence. Cleanup preserves evidence and removes only this run's processes and scratch state, using recorded PIDs or owned process groups, never process names.
- A blocked feature report names the concrete prerequisite and attempted route or command; never call a feature unreachable without them.

## Create

### 1. Discover before asking

Interview the repository, not the user: inspect relevant source, README/runbooks, package scripts, task runners, CI, tests, and project instructions. Before asking a question, establish:

| Discover | Establish |
| --- | --- |
| Primary surface | Whether users touch a web UI, CLI/TUI, desktop app, API/service, or another surface; note meaningful secondary surfaces without mapping everything. |
| Launch | Documented local command, required environment/auth/seed state, readiness signal, port, and shutdown behavior. |
| Drive harness | Prefer an existing Playwright/Cypress/WebDriver spec, HTTP client, command script, PTY/tmux helper, debug endpoint, or other repository harness; choose a generic approach only if none exists. |
| Evidence and side effects | Observable screenshots, terminal transcripts, response bodies, logs, exit codes, database records, files, messages, or other user-visible outcomes. |
| Feature map | The top three to five user-facing flows from routes, commands, menus, documentation, or source entry points. |
| Instance constraints | Whether ports, profiles, databases, queues, fixture data, auth, or external state allow concurrent instances. Prefer an existing isolated configuration; otherwise require one serial instance. |

If the base checkout cannot build or start, stop and report the concrete blocker. Ask only about an unobservable choice or blocked prerequisite, after reporting discovery.

### 2. Generate the artifact

Create `.agents/skills/verify-<app>/SKILL.md`, `features/README.md`, and one feature file per mapped flow. Do not leave placeholders, illustrative selectors, invented ports, or undocumented commands.

The generated `SKILL.md` defines:

- **Launch:** exact command; owned environment/state; readiness signal; ownership record; teardown. For CLI/TUI, build or install once and use a fresh isolated session per drive instead of a persistent server.
- **Doctor:** a read-only check that identifies the expected owned, ready instance, such as an owned PID plus health endpoint, version/build assertion, expected prompt, or authenticated endpoint.
- **Drive:** repository-grounded commands and stable selectors, routes, or prompts; the user path and return to known state.
- **Evidence:** exact paths and proof: capture the action and resulting visible state, then inspect the relevant side effect. In dry-run or test modes, observe what is actually skipped rather than trusting the name.
- **Cleanup:** preserve evidence; remove only owned instances and scratch state; distinguish ownership from a pre-existing developer instance.
- **Helpers:** each owned helper is executable, invoked from the skill body, and names its inputs and outputs. Do not add one when a documented existing command suffices.

`features/README.md` indexes feature files. Each file gives its user-facing flow and sub-features, route to it, concrete drive recipe, visible end state and side effect proving it, and prerequisites or gotchas. The map is evidence-backed, not a speculative product inventory.

### 3. Prove it

Execute the generated instructions for at least one mapped feature: launch and record ownership; run doctor; drive the real path; retain and inspect evidence including the required side effect; clean only owned resources; confirm the named evidence remains. After a failed attempt, clean owned residue before retrying. Change the artifact only from proof evidence. Until this sequence completes, it is a draft, not a delivered skill.

## Maintain

### 1. Locate and bound the target

Find project-local verification skills with launch, doctor, drive, evidence, cleanup, and a feature map. If none exists, stop and direct the user to Create. If several exist, ask which artifact to maintain.

Edit only the selected artifact: its `SKILL.md`, `features/`, and helpers inside its directory. Never change product code, production configuration, or another test harness during maintenance.

### 2. Audit source coverage

Read the feature index and every mapped feature. For each, trace current user-facing behavior and record its entry point, prerequisites, likely drift, and concrete live recipe. Independent feature research may use read-only subagents in parallel where available; the coordinator reconciles and spot-checks citations.

Inspect recent user-surface changes for a missing feature. Add one only with a concrete source path and user-facing route or command.

### 3. Run live coverage

Use the artifact's launch model. The coordinator drives every mapped feature once: serially for a shared instance or in fresh isolated sessions for short-lived processes. Preserve evidence throughout.

Classify each discovery:

- **Documentation drift:** user-facing description, route, prerequisite, or expected outcome is inaccurate. Correct the artifact.
- **Harness gap:** the app works but an owned helper or recipe cannot drive it. Correct and re-drive the artifact.
- **Product regression:** the documented or intended flow is broken. Report evidence; do not hide it by changing the map or product code.

A doctor check broken by artifact drift may be corrected and retried once, restarting only what that correction invalidated. Re-drive every changed drive helper before keeping it.

### 4. Report one outcome

- **Clean:** every mapped feature has source and live coverage; no artifact change is needed.
- **Changed:** live-proven artifact-only corrections; list feature coverage and evidence.
- **Blocked:** coverage or a safe artifact correction could not finish; name the blocker, prerequisite, attempted route, and retained evidence.

Keep concise run notes in the session workspace, not the project. After the final drive, clean owned run resources and verify retained evidence still exists.
