# How mode

Trace the real system in the order a reader needs:

1. Find the entry point or trigger and identify which package or component owns it.
2. Follow the call path through important decisions, state transitions, and data transformations.
3. Identify observable effects and boundaries: persistence, network or process calls, emitted events, rendering, scheduling, logs, or returned values, as applicable.
4. Explain where the important types, modules, and tests live and what responsibility each owns. Describe current placement and enforced dependency direction; do not turn this into advice about an unrequested redesign.
5. Surface only useful non-obvious constraints, such as ordering, lifecycle, validation, concurrency, compatibility, or generated-code boundaries, with evidence.

A typical answer is: a one-paragraph overview, a numbered runtime flow, a compact ownership map, and a short constraints section. Omit any section that adds no value.
