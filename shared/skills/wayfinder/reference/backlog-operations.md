# Backlog operations and task shapes

Command reference and description templates for the map and its children. Lifecycle guides and the CLI-only ownership rule are in `SKILL.md`.

## Core operations

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

## Updating the map

When a resolution sharpens part of the fog, create the new child and remove that item from **Not yet specified**. Re-read the map immediately before replacing its description with `backlog task edit <mapId> --description "<updated description>" --plain`; merge onto the latest version rather than overwriting concurrent changes.

If an existing child turns out to be out of scope, finalize it with that scope decision, mark it `Done`, update the map's **Out of scope** description, and do not add it as a route decision.
