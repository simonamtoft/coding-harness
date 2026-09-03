---
name: wayfinder
disable-model-invocation: true
description: Plan work too large or uncertain for one agent session as a Backlog.md map of investigation tasks, resolving one task per session until the route is clear.
---

# Wayfinder

Use Wayfinder when a destination is too large for one session and the route is still unclear. Chart the open decisions as a parent Backlog task with child investigation tasks, then resolve one child per session until nothing important remains undecided.

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

## Suggest next tickets

When invoked with an existing map, inspect its current children before choosing work:

1. Read the full child list with `backlog task list --parent <mapId> --plain`, then query the ready frontier with `backlog task list --parent <mapId> --status "To Do" --ready --sort ordinal --plain`.
2. Rank the frontier tickets that most directly advance the map by ordinal order. The map's dependencies and ordinal order define relevance; do not infer a different priority from task wording alone.
3. For each candidate, determine its **capacity** from the child description's **Mode**: `grilling` (HITL), `research` (AFK), `prototype` (HITL), or `task` (the stated manual prerequisite). If the map's **Notes** explicitly allow execution, identify eligible implementation work as `execution (authorized)`; otherwise do not recommend implementation.
4. Do not recommend blocked or completed children. Mention a blocked frontier only when no ready work remains, naming the unmet dependency. Treat children already resolved as out of the next-work list; surface an out-of-scope decision only if it changes the map's route.

When no map or destination is named, do not ask an open-ended clarification question. Inspect Backlog's ready work with `backlog task list --ready --sort priority --limit 10 --plain` and label each ordinary ready task `execution`. If context identifies a candidate's Wayfinder map, inspect that map and use its child capacity instead. State that no active map was identified when that is the case; do not claim or work a ticket yet.

Present candidates through one native structured selection question in the harness's `ask_question` format. Its question asks which ticket to handle next; its details name the map or state that no active map was identified. Offer at most the first three ranked candidates, with each option's label containing the ticket title, ID, and capacity and its description giving the question it resolves. The user may supply another ticket through the UI's free-text answer. If no candidate is ready, do not present a selection question; report the blocking condition instead.

A named child takes precedence only when it is ready; explain why it cannot be selected when blocked or complete.

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

A child is on the **frontier** when it is `To Do` and all dependencies are complete. Claim it by moving it to `In Progress` before doing any work so another session does not select it.

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

## Invocation

Never resolve more than one child task per session.

### Chart the map

The user invokes Wayfinder with a loose idea.

1. **Name the destination.** Use `/grill` and, when needed, `/domain-modeling` to settle what the map is finding its way to. The destination fixes scope.
2. **Map the frontier breadth-first.** Surface decisions across the whole effort rather than going deep on one thread. If no meaningful fog remains and the work fits one session, stop and ask whether to proceed directly to `/to-spec` or `/to-tickets`.
3. **Create the map** after reading the task-creation guide. Fill in Destination, Notes, Not yet specified, and Out of scope.
4. **Create every currently sharp child** in dependency order, using `--parent <mapId>` and `--depends-on` where needed.
5. Stop. Charting and resolving are separate sessions.

### Work through the map

The user invokes Wayfinder with a map task ID and optionally a child ID.

1. Read the map with `backlog task view <mapId> --plain`, then inspect and recommend next tickets as [Suggest next tickets](#suggest-next-tickets) requires.
2. If the user named a ready child, use it. Otherwise wait for the user to select a suggested ticket; claim it before working.
3. Read the child's **Mode** and resolve it with the relevant workflow. Fetch related tasks only when needed.
4. Read the finalization guide, record the answer in the child's final summary, verify its acceptance criteria when present, and mark it `Done` only when the guide's completion requirements are met.
5. Add one decision comment to the map. Create newly sharpened children and update Not yet specified or Out of scope as needed.

Other sessions may work on unblocked children concurrently. Re-read shared task state immediately before replacing it.
