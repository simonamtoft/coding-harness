# Reports

Decision ledger area. Entry ids use the `REP-` prefix; see `../DECISIONS.md` for the format and append rules.

`shared/skills/present`

### REP-01 · HTML only for substantial work with material added value
`constraint` · 2026-08-23 · `01a02d57`
**Decision:** Use `present` only when the work is substantial and the report adds value beyond the UI, the primary artifact, or concise Markdown.
**Why:** Results easily verified in the UI do not need a report.
**Revisit if:** The primary artifact cannot communicate the result.
**Evidence:** "when it's easily verifiable in the UI it shouldn't."

### REP-02 · Sections advance the conclusion, never repeat it
`constraint` · 2026-08-23 · `01a02d57`
**Decision:** The hero states the single overall conclusion; later sections substantiate, qualify, or operationalize it. Optional context fields are omitted unless interpretively essential.
**Why:** Repeated conclusions and generic side labels made reports harder to read.
**Revisit if:** A report genuinely needs contextual metadata to interpret evidence.
**Evidence:** "There are too many duplicate statements."

### REP-03 · Report pass/fail, not test counts
`constraint` · 2026-08-26 · `01a03f2b`
**Decision:** State verification outcome rather than routine counts; no oversized dependency visuals for a single completed task; include a visual only when it adds evidence or relationships. A short source-derived code excerpt is welcome when it explains the implementation better than prose.
**Why:** Exact pass counts were unnecessary and large presentations overexplained routine work.
**Revisit if:** Counts materially support the conclusion, or a report spans multiple tickets with real dependencies.
**Evidence:** "Why do we need exactly how many things have passed tests?"

### REP-04 · HTML reports are explicit opt-in while the presenter is refined
`reverted` · 2026-08-31 · `01a058b0`
**Decision:** Reverted the instruction that made `present` the default final delivery for substantial work. Deliver concise Markdown by default; use `present` only on an explicit user request while its report pipeline is refined.
**Why:** Disabling the skill's model invocation hid it from discovery but did not override the conflicting instruction. The resulting workflow produced an unhelpful raw HTML response rather than the intended report delivery.
**Revisit if:** The presenter reliably generates and returns the promised validated HTML-report link, and a user asks to reconsider automatic report delivery.

### REP-05 · Reports are spec-built before/after comparisons
`accepted` · 2026-11-04 · `01a1a7db-c13e-773a-940d-0554c9462f20`
**Decision:** The presenter writes a JSON spec of numbered changes, and `build-report.mjs` renders each one as a before/after pair: a side-by-side `diff` from Git, `image` screenshots, `terminal` output, `steps`, or a Mermaid `diagram` (sequence, workflow, architecture, dependencies) pre-rendered to static SVG. A change without `before` renders as one panel. Text is capped by the build: title 70, summary 160, change title 60, one optional `note` of 140 characters per change, and tags of 40. Refused: the sidebar dashboard template, prose/metric/limitation sections, and presenter-authored HTML (they produced text-heavy, inconsistent reports); hand-drawn SVG and Graphviz (one Mermaid syntax covers sequence diagrams too); an overlay diagram diff (the user chose side-by-side always); a timeline or Gantt kind (call order is what matters).
**Why:** The user wanted "mainly visuals, as little text as possible", then "tiny explainers" only. Caps in the build hold that line better than instructions alone.
**Revisit if:** Reports need a kind the five cannot express, or the caps repeatedly force essential information out.
**Evidence:** "Mainly visuals. As little text as possible."; "Important parts are timing diagrams, workflows, architecture, dependencies"; "Sequence (call order)"; "Side-by-side always".
