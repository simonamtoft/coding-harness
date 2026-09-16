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

### ASK-05 · Multi-select answers retain custom values
`accepted` · 2026-09-03 · `01a06728`
**Decision:** Opt-in multi-select questions use `multiple: true` and return an ordered string array; any typed custom answer appends to the selected labels. Ordinary questions continue returning a string.
**Why:** Callers can distinguish one answer from several without changing the established single-select shape, and choosing “other” must not discard the explicit selections.
**Revisit if:** Consumers need a richer per-selection source or identifier than a displayed label.

### ASK-06 · Explicit native clarification calls with five optional choices
`accepted` · 2026-09-08 · `01a080cf`
**Decision:** Prompt guidance explicitly requires `ask_question` rather than prose for blocking clarifications. Options are optional and model-chosen, capped at five.
**Why:** A `/grill` session asked fifteen blocking questions in prose despite the prior mandatory gate; three choices were unnecessarily restrictive. The existing panel remains for up to three choices; four and five use Pi’s scrolling native selector.
**Revisit if:** Models still bypass the explicit instruction, requiring runtime enforcement, or option counts need scrolling or search.

### ASK-07 · One Pi owner for the clarification policy, discovery before questions
`accepted` · 2026-09-14 · `01a09f75`
**Decision:** The extension-injected `CLARIFICATION_GATE` is the single Pi statement of clarification policy. `pi/agent/APPEND_SYSTEM.md`, whose whole content restated it, was deleted together with its `link.sh` entry; `promptGuidelines` keeps only the option-label mechanic the gate omits (ASK-01). The gate now leads with read-only discovery and gates consequential action rather than "before using any tool", and adds "inspection settles facts, not authorization" for ambiguous destructive requests. `shared/AGENTS.md` §1 is unchanged and stays harness-neutral.
**Why:** Four layers repeated the same policy, and "before using any tool" contradicted the instruction to inspect the repository first. Probes on gpt-5.6-terra showed the before-state asking about export formats and legacy deletions with zero repository reads; the after-state inspected first and asked grounded questions. The destructive clause was added because the first after-state wording let the model delete ambiguously scoped files once inspection found plausible targets.
**Revisit if:** Pi-only prose guidance is needed again outside extension code, or models begin under-asking on material choices.
