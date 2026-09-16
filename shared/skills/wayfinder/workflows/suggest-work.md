# Suggest work

The invocation named no map and no idea, so find the next useful work from the tracker.

1. Read Backlog's ready work with `backlog task list --ready --sort priority --limit 10 --plain`. Label each ordinary ready task `execution`.
2. If context identifies a candidate's Wayfinder map, read that map and use its child capacity instead, following the ranking rules below. State that no active map was identified when that is the case.
3. Rank candidates and present them through **one** structured selection question (see [Presenting candidates](#presenting-candidates)).
4. Do not claim or work a ticket yet. Wait for the selection, then continue with `workflows/work-through-map.md`.

## Ranking a map's frontier

When a map is in play, inspect its children before choosing work:

1. Read the full child list with `backlog task list --parent <mapId> --plain`, then query the ready frontier with `backlog task list --parent <mapId> --status "To Do" --ready --sort ordinal --plain`.
2. Rank the frontier tickets that most directly advance the map by ordinal order. The map's dependencies and ordinal order define relevance; do not infer a different priority from task wording alone.
3. Determine each candidate's **capacity** from the child description's **Mode**: `grilling` (HITL), `research` (AFK), `prototype` (HITL), or `task` (the stated manual prerequisite). If the map's **Notes** explicitly allow execution, identify eligible implementation work as `execution (authorized)`; otherwise do not recommend implementation.
4. Do not recommend blocked or completed children. Mention a blocked frontier only when no ready work remains, naming the unmet dependency. Treat resolved children as out of the next-work list; surface an out-of-scope decision only if it changes the map's route.

A child is on the **frontier** when it is `To Do` and all dependencies are complete.

## Presenting candidates

Use one native structured selection question in the harness's `ask_question` format. The question asks which ticket to handle next; the details name the map or state that no active map was identified. Offer at most the first three ranked candidates. Each option's label carries the ticket title, ID, and capacity; its description gives the question it resolves. The user may supply another ticket through the free-text answer.

If no candidate is ready, present no selection question and report the blocking condition instead.
