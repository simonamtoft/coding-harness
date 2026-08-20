# Backlog dependency maps

When a report exposes tickets from `backlog.md`, make a dependency map the section's primary artifact instead of presenting the tickets only as a flat ordered list or table. Start from [../assets/backlog-dependency-map.html](../assets/backlog-dependency-map.html), then add, remove, and position lanes, nodes, and edges to fit the actual work.

## Encode the work

Use the template's conventions consistently:

- A horizontal lane is a workstream that one person or pair can own. Separate lanes can proceed in parallel.
- Within each lane, place tickets from left to right in the recommended implementation order. Tickets that should start together align in the same stage column, even when they are in different lanes.
- Order lanes from top to bottom by recommendation: earliest or highest-value work first, deferrable work last. Label lanes by outcome or ownership rather than `Lane 1`.
- Label stage columns by scheduling meaning, such as `Start first`, `Then`, and `If capacity`, rather than generic depth numbers.
- Use a solid arrow only for a hard dependency stated in `backlog.md` or established by the report's evidence.
- Use a dashed arrow for a recommended handoff or sequence that is not blocking. Priority and prose such as “take these first, then…” belong in node position and dashed sequencing, not in invented dependency edges.
- Leave tickets unconnected when neither a dependency nor a recommendation relates them. If all tickets can start together, show one stage with parallel lanes instead of forcing branches.
- Each node shows the exact ticket ID and a short title. Use node treatments only when priority, type, or status materially helps scheduling.

Translate any narrative implementation recommendation into the map itself. For example, if two tickets should start first, a delivery ticket follows, three correctness tickets then parallelize, and two maintenance tickets are optional, align and connect those groups in that order. Do not repeat the same sequence in a paragraph below the diagram.

## Build and review the visual

- Use the HTML template's `<figure>` and inline `.graph` SVG; do not substitute an ASCII or preformatted text tree.
- Draw edges before nodes so connectors remain behind labels. Route cross-lane edges around nodes and avoid line crossings where practical.
- Resize the SVG `viewBox` and lane bands for the actual ticket count. Duplicate or remove the sample groups rather than squeezing labels until they are unreadable.
- Add a concise `aria-label` and `figcaption` that summarize parallel work, hard blockers, and what can be deferred. The report must remain understandable without relying on color alone.
- A compact table may follow when ticket details do not fit in nodes, but it must support rather than duplicate the map or its suggested order.
