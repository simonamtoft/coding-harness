# Clarification UI

Decision ledger area. Entry ids use the `ASK-` prefix; see `../DECISIONS.md` for the format and append rules.

`pi/agent/extensions/ask-question`

### ASK-01 · Recommendation is expressed by ordering
`constraint` · 2026-08-30 · `01a05443`
**Decision:** Removed the `recommended` field and label; options are ordered best first, with reasoning carried by the option description or question details.
**Why:** Explicit user preference for positional recommendation over the word "recommended".
**Revisit if:** Recommendation must be distinguished from ordering, or options become reorderable.

### ASK-02 · Decision context goes in `details`, plans go in the message
`accepted` · 2026-08-26, 2026-08-30 · `01a03cfd`, `01a05443`
**Decision:** Each question carries a `details` field with the deciding context; plan approvals keep the plan in the assistant message.
**Why:** A question once appeared without the plan it asked about. Details stay visible in the TUI and persist in the tool result, whereas a full plan does not fit the panel.
**Revisit if:** Non-TUI clients cannot display or persist `details`.
**Evidence:** "It didn't show me any plan."

### ASK-03 · Hand-rolled option rows instead of `SelectList`
`reverted` · 2026-08-30 · `01a05443`
**Decision:** Replaced the composed `SelectList` with an option list that wraps labels and descriptions; wrap and cache by terminal width; free-text editing stays inside the panel with `Esc` returning to the list.
**Why:** `SelectList` truncates each option to one line, and scrolling or fuzzy search adds nothing for at most three options. The panel vanishes once answered, so persisted details are the only trace of the rationale.
**Revisit if:** Option counts grow enough to need scrolling or search.

### ASK-04 · Popup extensions share a terminal UI lock
`accepted` · 2026-08-30 · `01a05443`
**Decision:** Coordinate through a `globalThis` promise-chain lock: queue `ask_question`, fail fast for `/ctx-monitor`.
**Why:** Separately loaded extensions can otherwise both claim terminal input; silently queueing a slash command looks like a hang.
**Revisit if:** Pi provides native popup ownership.
