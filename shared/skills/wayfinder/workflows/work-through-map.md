# Work through the map

The invocation named a map, and optionally a child. Resolve exactly one child this session.

1. Read the map with `backlog task view <mapId> --plain`.
2. Select the child. A named child takes precedence only when it is ready; explain why it cannot be selected when blocked or complete. Otherwise rank the frontier and present candidates as `workflows/suggest-work.md` requires, then wait for the selection.
3. Claim it before doing any work: read the task-execution guide, then `backlog task edit <id> --status "In Progress" --assignee <assignee> --plain`, so another session does not select it.
4. Read the child's **Mode** and resolve it with the matching workflow from the Modes section of `SKILL.md`. Fetch related tasks only when needed.
5. Read the task-finalization guide, record the answer in the child's final summary, verify its acceptance criteria when present, and mark it `Done` only when that guide's completion requirements are met.
6. Add one decision comment to the map. Create newly sharpened children and update **Not yet specified** or **Out of scope** as needed, following `reference/backlog-operations.md`.
