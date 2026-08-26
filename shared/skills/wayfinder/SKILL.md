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

1. Read the map with `backlog task view <mapId> --plain`.
2. If the user named a child, use it. Otherwise select the first result from the frontier query. Claim it before working.
3. Read the child's **Mode** and resolve it with the relevant workflow. Fetch related tasks only when needed.
4. Read the finalization guide, record the answer in the child's final summary, verify its acceptance criteria when present, and mark it `Done` only when the guide's completion requirements are met.
5. Add one decision comment to the map. Create newly sharpened children and update Not yet specified or Out of scope as needed.

Other sessions may work on unblocked children concurrently. Re-read shared task state immediately before replacing it.
