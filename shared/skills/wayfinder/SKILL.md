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

Dispatch on what the invocation supplied, not on the order of the rows below. Read only the selected workflow; each one names the further reference it needs. Every document path in this skill, including inside the workflow documents, is relative to this skill's root directory.

| The invocation supplies | Path | First read | Then read |
| --- | --- | --- | --- |
| Nothing beyond the invocation itself | Suggest work | `backlog task list --ready --sort priority --limit 10 --plain` | `workflows/suggest-work.md` |
| A map ID, optionally a child ID | Work through the map | `backlog task view <mapId> --plain` | `workflows/work-through-map.md` |
| A loose idea with no existing map | Chart a map | `backlog search "<idea keywords>" --plain` | `workflows/chart-map.md` |

A loose idea that turns out to match an existing map is the map path, not the charting path. When the invocation supplies an idea or a map, start from the search or map read in its row; the ready list belongs to the suggest-work path alone.

## Session limits

Never resolve more than one child task per session.

Wayfinder is planning by default. Each child task resolves a decision; the map is complete when the route to the destination is clear. The urge to implement usually means the work is ready to hand to `/to-spec` and `/to-tickets`. A map may explicitly allow execution in its **Notes**, but otherwise produce decisions rather than the destination itself.

## Modes

Every child task states one **Mode**, which fixes both how it is resolved and the capacity it needs. Each mode is either **HITL** (worked with the human) or **AFK** (driven by the agent alone):

- **research** (AFK): Read documentation, third-party APIs, or local resources. Put the answer in the task's final summary; add durable supporting documents or URLs through Backlog references or documentation fields.
- **prototype** (HITL): Build a cheap concrete artifact via `/prototype` to answer how something should look or behave. Record the verdict in the task. Preserve and reference the artifact only when durable evidence is required.
- **grilling** (HITL): Resolve the question through `/grill`, using `/domain-modeling` when terminology or invariants need clarification. This is the default.
- **task** (HITL or AFK): Complete a manual prerequisite that blocks a later decision, such as provisioning access or moving sample data. Record what was done and the facts later tasks need.

A HITL task never resolves by having the agent invent the human's answers.

## Refer by name

Refer to maps and tasks by title in human-facing prose, with the Backlog ID included when needed. Titles communicate meaning; bare IDs do not.

## Backlog.md ownership

The map and its children are Backlog tasks. Use the Backlog CLI for every read or update; never edit files under `backlog/` directly. `reference/backlog-operations.md` holds the command reference and the map and child description templates.

Before each lifecycle action, read the matching guide:

- `backlog instructions task-creation` before creating the map or child tasks
- `backlog instructions task-execution` before claiming work, planning, or adding implementation notes
- `backlog instructions task-finalization` before completing a child or the map

Other sessions may work unblocked children concurrently. Re-read shared task state immediately before replacing it.
