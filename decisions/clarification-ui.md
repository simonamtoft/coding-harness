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
**Superseded by:** ASK-08 for the tool name and the five-option cap; the explicit-call requirement stands.

### ASK-07 · One Pi owner for the clarification policy, discovery before questions
`accepted` · 2026-09-14 · `01a09f75`
**Decision:** The extension-injected `CLARIFICATION_GATE` is the single Pi statement of clarification policy. `pi/agent/APPEND_SYSTEM.md`, whose whole content restated it, was deleted together with its `link.sh` entry; `promptGuidelines` keeps only the option-label mechanic the gate omits (ASK-01). The gate now leads with read-only discovery and gates consequential action rather than "before using any tool", and adds "inspection settles facts, not authorization" for ambiguous destructive requests. `shared/AGENTS.md` §1 is unchanged and stays harness-neutral.
**Why:** Four layers repeated the same policy, and "before using any tool" contradicted the instruction to inspect the repository first. Probes on gpt-5.6-terra showed the before-state asking about export formats and legacy deletions with zero repository reads; the after-state inspected first and asked grounded questions. The destructive clause was added because the first after-state wording let the model delete ambiguously scoped files once inspection found plausible targets.
**Revisit if:** Pi-only prose guidance is needed again outside extension code, or models begin under-asking on material choices.

### ASK-08 · Tool renamed ask_user_question and shaped for Paseo's question form
`accepted` · 2026-10-22 · `01a16348`
**Decision:** On `paseo-trial`, `ask_question` is renamed `ask_user_question` everywhere and its parameters follow `rpiv-ask-user-question`: a required `header`, options with required descriptions, 2–4 options, at most 4 questions, and `multiSelect` instead of `multiple` (ASK-05's array answers are unchanged). Outside the TUI the tool replays rpiv's dialog order: one select whose last entry is the custom answer followed by an input, one comma-separated input for multi-select, and no back or review dialogs. Free-text-only questions stay allowed and make that call use generic cards. `details` stays for the TUI and transcript, and the gate also requires self-contained question text. The legacy `prepareArguments` normalization (string options, single-question shape, `recommended`) is removed because it produced arguments the new schema rejects. `quick-commit` writes its plan and planner details in the assistant response, since the form would hide them. Rejected: naming the tool by mode, requiring options on every question, and keeping the five-option cap.
**Why:** Paseo renders one native form only for tool names and argument shapes it recognizes, and it answers the tool's RPC dialogs by replaying rpiv's order; any extra dialog is cancelled. It reads the model's raw arguments before `prepareArguments` runs, so the model itself must emit the shape. Unrecognized calls showed one card per question, toggle, custom answer, and review step. Paseo's form shows the question, header, and option descriptions but not `details`, which met ASK-02's revisit condition.
**Revisit if:** The Paseo trial is dropped (PI-108); Paseo changes its rpiv adapter or adds a way to register other question tools; or Paseo users report deciding without needed context.
**Evidence:** User chose "Rename everywhere", "Match rpiv; free text allowed", and "Keep, plus self-contained question".

### ASK-09 · Under Paseo the deciding context goes in prose before the question form
`accepted` · 2026-11-05 · `01a1aad3`
**Decision:** The clarification gate depends on `ctx.mode`. In the TUI it is unchanged: context goes in each question's `details` field and the response holds only the `ask_user_question` call. In every other mode, including Paseo's RPC mode, the model writes the deciding context in the assistant response, grouped by question, before the call; questions stay self-contained and the call is still not batched with other tools. Rejected: folding the context into the question text, and prose for every client.
**Why:** A live PI-109 check in Paseo confirmed that its question form hides `details`, so the TUI rule "do not restate the details in prose" left the user deciding without context, which is ASK-08's revisit condition. Packing facts into question text makes long questions; prose everywhere would show context twice in the TUI, whose panel already renders `details`.
**Revisit if:** Paseo starts rendering `details` (or another description field) in its question form, or the TUI stops showing `details`.
**Evidence:** User reported "No, hidden" in Paseo and chose "Prose in RPC mode".
