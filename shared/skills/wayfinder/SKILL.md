---
name: wayfinder
disable-model-invocation: true
description: Plan work too large or uncertain for one agent session as a Backlog.md map of investigation tasks, resolving one task per session until the route is clear.
---

# Wayfinder

Use Wayfinder when a destination is too large for one session and the route is still unclear. Chart the open decisions as a parent Backlog task with child investigation tasks, then resolve one child per session until nothing important remains undecided.

## First action

**Your first tool call is a Backlog read, never a question.** Wayfinder is invoked to find or advance work, and the tracker already holds the answer to "which work". Do not open with a clarification question — not about the destination, not about which map to use, not about what the user wants. Read the tracker, then ask a question that names real tickets.

## Which path

Dispatch on what the invocation supplied, not on the order of the sections below:

| The invocation supplies | Path | First read |
| --- | --- | --- |
| Nothing, or only the skill | [Suggest work](#1-suggest-work) | `backlog task list --ready --sort priority --limit 10 --plain` |
| A map ID, optionally a child ID | [Work through the map](#2-work-through-the-map) | `backlog task view <mapId> --plain` |
| A loose idea with no existing map | [Chart a map](#3-chart-a-map) | `backlog search "<idea keywords>" --plain` |

A loose idea that turns out to match an existing map is path 2, not path 3. Search before charting.

## 1. Suggest work

1. Read Backlog's ready work with `backlog task list --ready --sort priority --limit 10 --plain`. Label each ordinary ready task `execution`.
2. If context identifies a candidate's Wayfinder map, read that map and use its child capacity instead, following the ranking rules below. State that no active map was identified when that is the case.
3. Rank candidates and present them through **one** structured selection question (see [Presenting candidates](#presenting-candidates)).
4. Do not claim or work a ticket yet. Wait for the selection, then continue on path 2.

### Ranking a map's frontier

When a map is in play, inspect its children before choosing work:

1. Read the full child list with `backlog task list --parent <mapId> --plain`, then query the ready frontier with `backlog task list --parent <mapId> --status "To Do" --ready --sort ordinal --plain`.
2. Rank the frontier tickets that most directly advance the map by ordinal order. The map's dependencies and ordinal order define relevance; do not infer a different priority from task wording alone.
3. Determine each candidate's **capacity** from the child description's **Mode**: `grilling` (HITL), `research` (AFK), `prototype` (HITL), or `task` (the stated manual prerequisite). If the map's **Notes** explicitly allow execution, identify eligible implementation work as `execution (authorized)`; otherwise do not recommend implementation.
4. Do not recommend blocked or completed children. Mention a blocked frontier only when no ready work remains, naming the unmet dependency. Treat resolved children as out of the next-work list; surface an out-of-scope decision only if it changes the map's route.

### Presenting candidates

Use one native structured selection question in the harness's `ask_question` format. The question asks which ticket to handle next; the details name the map or state that no active map was identified. Offer at most the first three ranked candidates. Each option's label carries the ticket title, ID, and capacity; its description gives the question it resolves. The user may supply another ticket through the free-text answer.

If no candidate is ready, present no selection question and report the blocking condition instead.

## 2. Work through the map

Never resolve more than one child task per session.

1. Read the map with `backlog task view <mapId> --plain`.
2. Select the child. A named child takes precedence only when it is ready; explain why it cannot be selected when blocked or complete. Otherwise rank the frontier and present candidates as path 1 requires, then wait for the selection.
3. Claim it before doing any work: read the task-execution guide, then `backlog task edit <id> --status "In Progress" --assignee <assignee> --plain`, so another session does not select it.
4. Read the child's **Mode** and resolve it with the matching workflow from [Modes](#modes). Fetch related tasks only when needed.
5. Read the task-finalization guide, record the answer in the child's final summary, verify its acceptance criteria when present, and mark it `Done` only when that guide's completion requirements are met.
6. Add one decision comment to the map. Create newly sharpened children and update **Not yet specified** or **Out of scope** as needed.

Other sessions may work unblocked children concurrently. Re-read shared task state immediately before replacing it.

## 3. Chart a map

1. **Name the destination.** Use `/grill` and, when needed, `/domain-modeling` to settle what the map is finding its way to. The destination fixes scope.
2. **Map the frontier breadth-first.** Surface decisions across the whole effort rather than going deep on one thread. If no meaningful fog remains and the work fits one session, stop and ask whether to proceed directly to `/to-spec` or `/to-tickets`.
3. **Create the map** after reading the task-creation guide. Fill in Destination, Notes, Not yet specified, and Out of scope.
4. **Create every currently sharp child** in dependency order, using `--parent <mapId>` and `--depends-on` where needed.
5. Stop. Charting and resolving are separate sessions.

## Plan, don't do

Wayfinder is planning by default. Each child task resolves a decision; the map is complete when the route to the destination is clear. The urge to implement usually means the work is ready to hand to `/to-spec` and `/to-tickets`.

A map may explicitly allow execution in its **Notes**, but otherwise produce decisions rather than the destination itself.

## Refer by name

Refer to maps and tasks by title in human-facing prose, with the Backlog ID included when needed. Titles communicate meaning; bare IDs do not.

## Backlog.md ownership

The map and its children are Backlog tasks. Use the Backlog CLI for every read or update; never edit files under `backlog/` directly.

Before each lifecycle action, read the matching guide:

- `backlog instructions task-creation` before creating the map or child tasks
- `backlog instructions task-execution` before claiming work, planning, or adding implementation notes
- `backlog instructions task-finalization` before completing a child or the map

Core operations:

| Intent | Command |
| --- | --- |
| Create the map | `backlog task create "<map title>" --type task --description "<map description>" --plain` |
| Create a child | `backlog task create "<title>" --parent <mapId> --type spike --description "<question and mode>" --plain` |
| Add blockers | supply `--depends-on <id1>,<id2>` when creating the child, or use `backlog task edit <id> --depends-on <id1>,<id2> --plain` |
| Read a task | `backlog task view <id> --plain` |
| Find the frontier | `backlog task list --parent <mapId> --status "To Do" --ready --sort ordinal --plain` |
| Claim a child | `backlog task edit <id> --status "In Progress" --assignee <assignee> --plain` |
| Record progress | `backlog task edit <id> --append-notes "<note>" --plain` |
| Record a map decision | `backlog task edit <mapId> --comment "<task title> (<id>) — <one-line gist>" --plain` |

`--depends-on` replaces the task's complete dependency set. Omit it when a child has no blockers. Do not invent labels or tracker setup.

## The map

The parent task is the canonical low-resolution view. Its description contains:

```markdown
## Destination

<One or two lines describing what this effort is finding its way to: a specification, a decision, or a change.>

## Notes

<Domain context, skills to consult, and any explicit override that allows execution inside the map.>

## Not yet specified

<In-scope questions that are visible but not yet sharp enough to become tasks.>

## Out of scope

<Work deliberately beyond this destination.>
```

The map is an index, not a second store of detailed answers. Closed child tasks hold their full resolutions. Append one short decision pointer to the map as a comment; do not duplicate the resolution in the map description.

Open work is represented by child tasks, so do not list it again in the map description.

## Child tasks

Each child asks one question that fits in one fresh agent session. Its description uses:

```markdown
## Question

<The decision or investigation this task resolves.>

**Mode:** research | prototype | grilling | task
```

Create investigation children as Backlog `spike` tasks. Use type `task` only for a manual prerequisite with no decision of its own.

A child is on the **frontier** when it is `To Do` and all dependencies are complete.

### Modes

Each mode is either **HITL** (worked with the human) or **AFK** (driven by the agent alone):

- **research** (AFK): Read documentation, third-party APIs, or local resources. Put the answer in the task's final summary; add durable supporting documents or URLs through Backlog references or documentation fields.
- **prototype** (HITL): Build a cheap concrete artifact via `/prototype` to answer how something should look or behave. Record the verdict in the task. Preserve and reference the artifact only when durable evidence is required.
- **grilling** (HITL): Resolve the question through `/grill`, using `/domain-modeling` when terminology or invariants need clarification. This is the default.
- **task** (HITL or AFK): Complete a manual prerequisite that blocks a later decision, such as provisioning access or moving sample data. Record what was done and the facts later tasks need.

A HITL task never resolves by having the agent invent the human's answers.

## Fog of war

Do not chart what cannot yet be stated precisely. Put visible but still vague in-scope questions under **Not yet specified**. A question becomes a child task once it can be phrased precisely, even if another task blocks it.

- **Child task:** the question is sharp now.
- **Not yet specified:** the area is in scope, but the question is not yet sharp.
- **Out of scope:** the work lies beyond the destination.

When a resolution sharpens part of the fog, create the new child and remove that item from **Not yet specified**. Re-read the map immediately before replacing its description with `backlog task edit <mapId> --description "<updated description>" --plain`; merge onto the latest version rather than overwriting concurrent changes.

If an existing child turns out to be out of scope, finalize it with that scope decision, mark it `Done`, update the map's **Out of scope** description, and do not add it as a route decision.
