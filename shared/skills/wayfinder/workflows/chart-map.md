# Chart a map

The invocation supplied a loose idea and the tracker search found no existing map. Charting and resolving are separate sessions: create the map, then stop.

1. **Name the destination.** Use `/grill` and, when needed, `/domain-modeling` to settle what the map is finding its way to. The destination fixes scope.
2. **Map the frontier breadth-first.** Surface decisions across the whole effort rather than going deep on one thread. If no meaningful fog remains and the work fits one session, stop and ask whether to proceed directly to `/to-spec` or `/to-tickets`.
3. **Create the map** after reading the task-creation guide. Fill in Destination, Notes, Not yet specified, and Out of scope, using the template in `reference/backlog-operations.md`.
4. **Create every currently sharp child** in dependency order, using `--parent <mapId>` and `--depends-on` where needed. Each child asks one question that fits one fresh agent session and states its **Mode**.
5. Stop.

## Fog of war

Do not chart what cannot yet be stated precisely. Put visible but still vague in-scope questions under **Not yet specified**. A question becomes a child task once it can be phrased precisely, even if another task blocks it.

- **Child task:** the question is sharp now.
- **Not yet specified:** the area is in scope, but the question is not yet sharp.
- **Out of scope:** the work lies beyond the destination.
