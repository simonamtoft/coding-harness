---
name: present
description: Present substantive completed work as a self-contained HTML report. Use for final reports after implementations, investigations, reviews, or plans with enough content to benefit from a structured visual summary. Do not use for quick answers, clarifying questions, progress updates, or trivial changes.
---

# Present completed work

Follow the active repository's `CLAUDE.md` or `AGENTS.md`, especially **Present Clearly**. Use the smallest self-contained report that makes the outcome, evidence, and limitations easy to scan.

## Build

1. Generate one collision-resistant report ID. Use it for all temporary artifacts and write the report to `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/agent-final-<report-id>.html`. Never use unsuffixed `agent-final.html` or `agent-final-captures` paths.
2. Assemble the page with `scripts/assemble-report.mjs`; do not hand-author the full page or read, copy, or rewrite `assets/report-template.html` unless modifying or debugging the skill.
   - Use a **simple report** only when prose explains the result as well as any source-grounded capture, flow, state transition, comparison, dependency, or structured evidence. Use [assets/simple-report-manifest.example.json](assets/simple-report-manifest.example.json).
   - Otherwise use a **custom visual report**: read only relevant `assets/sections/` snippets and conditional assets, then provide report-specific navigation and sections using [assets/report-manifest.example.json](assets/report-manifest.example.json).
   - Set `outputFile` to the ID-scoped path and overwrite only artifacts carrying that ID.
3. Read [references/report-data.md](references/report-data.md) only when evidence mixes command, test, and probe units, or when tickets need scheduling. Normalize only the fields needed by the report; do not create duplicate scratch JSON unless a script consumes it.

## Compose

Include only outcome, key changes/findings/decisions, verification, and limitations or follow-ups that advance the reader's understanding. Do not add sections, labels, captions, metrics, or cards that restate the conclusion, describe report writing, record inaction, or inflate a single fact.

- **Verification:** name checks and state passed, failed, or unavailable. Omit test-case totals and ratios unless they materially support the conclusion.
- **Evidence:** use a capture, comparison, short source-derived code or configuration excerpt, diagram, coverage matrix, compact table, or exact output only when it explains evidence or a relationship faster than concise prose. Code excerpts must show essential logic, API, or configuration; cite the file and omit boilerplate. Do not invent visual details, data, or behavior.
- **Structure:** show lifecycle, lineage, ownership, routing, dependencies, or invalidation when that structure matters; for example, show a version transition or which mutations retain assurance. For user-visible work, place a faithful screenshot or rendered output near the outcome; otherwise use an exact fixture or source-derived capture, or disclose that no trustworthy capture was practical. Do not substitute an architecture diagram for evidence of a UI or TUI.
- **Reading path:** use a one-column hero (label, title, summary). Later content must substantiate, qualify, or operationalize it. Give each section one dominant idea, use one primary surface and at most one supporting surface unless comparing, and group related details rather than creating cards for each fact. Omit generic section context, repeated labels, and dashboard treatment of absence.
- **Markup:** keep the index synchronized with major sections. Use existing template primitives: `.grid`, `.card`, `.span-*`, `.prose`, `.visual-example`, `.screen-frame`, `.terminal`, `figcaption`, `.metric`, `.status-list`, `.data-table`, `.concept-diff`, inline-SVG `.graph`, `.chart`, `.bar-row`, `.decision`, `.callout`, and badges. Keep all assets inline, add no network dependencies, and keep the report readable without navigation.

## Backlog

For one completed, dependency-free ticket, mention its ID and status in the hero subtitle or relevant prose. Do not add a Backlog section, completion visual, or acceptance-criteria count. For multiple tickets, dependencies, or scheduling, read and follow [references/backlog-dependency-map.md](references/backlog-dependency-map.md).

## Validate

1. Run `scripts/validate-report.mjs` on the completed report and fix placeholders, duplicate or missing local targets, unsynchronized index items, and external runtime dependencies.
2. If the active repository provides Playwright, run `scripts/render-report.mjs <report-path> ${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/agent-final-<report-id>-captures` from the repository. Do not install browser dependencies. Use `--all` only for prose-only layout inspection.
3. Inspect captures before delivery for hierarchy, legibility, navigation, arrows, wrapping, contrast, first-viewport clarity, and clipping. If browser tooling is unavailable, disclose it in the report.
4. Read the HTML as a reader. Remove repeated, unsupported, weak, or decorative content. Compare every visual and code excerpt with its capture or source; replace or omit anything unfaithful.

## Deliver

Return only:

```markdown
[Open final report](file://<absolute-path>)
```
