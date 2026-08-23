---
name: present
description: Present substantive completed work as a self-contained HTML report. Use for final reports after implementations, investigations, reviews, or plans with enough content to benefit from a structured visual summary. Do not use for quick answers, clarifying questions, progress updates, or trivial changes.
---

# Present completed work

Create a visual report that makes the outcome, evidence, and remaining limitations easy to scan while retaining enough prose to explain context and reasoning.

Follow the active repository's `CLAUDE.md` or `AGENTS.md` presentation guidance, especially **Present Clearly**. This skill specializes that guidance for final HTML reports and does not override it. Use the smallest representation that exposes the important structure.

## Build the report

Before creating any artifacts, generate one collision-resistant report ID for this delivery (for example, the first 12 lowercase hexadecimal characters of a UUID). Reuse that ID while revising and validating this report, and use a different ID for every independently running report workflow. Name the output `${TMPDIR:-/tmp}/agent-final-<report-id>.html` and include the same ID in manifests, fragments, and capture directories. Never use the unsuffixed `agent-final.html` or `agent-final-captures` paths: parallel agents can overwrite them.

1. Assemble rather than hand-author the complete page. Choose one path:
   - **Simple report:** use only when the result is genuinely prose-led and no source-grounded screenshot, flow, state transition, comparison, dependency, or structured evidence would explain it faster. Write one manifest following [assets/simple-report-manifest.example.json](assets/simple-report-manifest.example.json); the assembler generates navigation and sections. Do not choose this path merely because it is quicker.
   - **Custom visual report:** use when behavior can be shown as captures, diagrams, tables, comparisons, or a specialized layout. Read only the matching snippets under `assets/sections/` and any conditional asset named by this skill. Write report-specific navigation and section fragments plus a manifest following [assets/report-manifest.example.json](assets/report-manifest.example.json).
   - Run `scripts/assemble-report.mjs` from this skill directory with the manifest's `outputFile` set to `${TMPDIR:-/tmp}/agent-final-<report-id>.html`. Overwrite only temporary artifacts carrying this report's ID on each turn.
   - Do not read [assets/report-template.html](assets/report-template.html) during normal report generation. The assembler owns the shell; read it only when modifying or debugging the skill. Do not paste or rewrite its CSS in report-specific content.
2. When the report mixes command/test/probe units or exposes backlog tickets with scheduling, read [references/report-data.md](references/report-data.md) and normalize the evidence before composing HTML. Do not read it merely because several metrics share one unit, and do not create duplicate scratch JSON unless a script consumes it.
3. Include only sections that carry useful information:
   - outcome
   - key changes, findings, or decisions
   - verification performed
   - limitations or follow-ups
   - omit any section whose only purpose is to restate the outcome, describe the report-writing process, or record that no action was taken
4. Make substantive reports visual-first, not prose with decoration:
   - identify the one or two relationships the reader must understand, then lead with the closest source-grounded visual: an actual capture, before/after comparison, state or data-flow diagram, coverage matrix, compact table, or exact command output
   - if a change concerns lifecycle, lineage, ownership, routing, dependencies, or invalidation, show that structure instead of describing it only in paragraphs
   - for example, a snapshot/versioning change should normally show old version → immutable reference → successor version, and an assurance change should show which input mutations retain or revoke assurance
   - keep introductory prose to the conclusion plus essential context; prefer one short paragraph per visual and move labels or evidence into the visual itself
   - avoid consecutive prose-only sections when their content can be combined into one visual section
   - do not invent data or add decorative charts, generic icons, or diagrams that merely restate prose; omit a visual when there is no trustworthy structure or evidence to show
5. Build a clear top-to-bottom reading path rather than a card for every fact:
   - keep the report hero in one column: label, title, then summary; treat the hero as the single statement of the overall conclusion
   - every later section must advance, substantiate, qualify, or operationalize that conclusion rather than restating or lightly paraphrasing it
   - keep primary explanatory prose in the main reading path; do not create a competing prose column beside it
   - place supporting visuals or compact evidence beside or below the main content according to what scans best; side content may appear on either side
   - give each section one dominant idea or artifact
   - prefer one primary surface plus at most one supporting surface; use more only for a genuine comparison
   - group related details in prose, a list, or a table instead of separate cards
   - state each claim at the highest-value location and do not repeat it in the hero, section introduction, card, metric, caption, and summary; paraphrasing still counts as repetition
   - omit optional right-aligned section context by default; include it only when readers need that information to interpret the section and it is not already conveyed by the heading or body
   - never use section context for generic signposting or process notes such as “recommended progression,” “based on a read of,” or “read-only review”; put consequential provenance in the report footer or review basis instead
   - omit labels that merely repeat the adjacent heading, and use badges, tags, labels, and metrics only when they encode information
   - do not turn absence into dashboard content: zero commands, zero edits, or unchanged counts belong only in concise prose when they materially constrain the conclusion
6. When the implementation has a user-visible visual result, show it near the outcome:
   - run the implemented surface and prefer an actual screenshot or captured output, embedded into the HTML
   - if a screenshot is impractical, use exact rendered text, an existing fixture, or another source-derived capture; reconstruct the result only when it can be mechanically faithful
   - if no trustworthy capture is practical, omit the example and disclose that limitation instead of inventing a mockup
   - show one primary state and only the additional states needed to explain important behavior
   - do not substitute an architecture diagram for evidence of what the implemented UI or TUI looks like
   - do not invent visual details, behavior, states, or sample values
7. Keep the persistent index synchronized with the report sections. Every index item must link to a section, and every major section must appear in the index.
8. Compose the report from the template's existing primitives:
   - `.grid`, `.card`, and `.span-*` for grouped layout
   - `.prose` for explanations that need more than a label or bullet
   - `.visual-example`, `.screen-frame`, `.terminal`, and `figcaption` for implemented visuals
   - `.metric`, `.status-list`, `.data-table`, and `.concept-diff` for evidence
   - `.graph` with inline SVG for relationships and flows
   - `.chart` or `.bar-row` for small data visualizations
   - `.decision`, `.callout`, and badges for meaningful emphasis
9. Choose the clearest representation for each point. Use prose when the reader needs context or rationale; use a visual when it makes the implemented result, a relationship, comparison, trend, or structure easier to understand.
10. Keep the report self-contained. Do not add network dependencies or external assets. Embed captures and inline report-specific SVG geometry and data in the HTML.
11. Make the report readable without interaction; navigation may enhance it but must not be required to access the content.

## Show backlog work as a dependency map

When a report exposes tickets from `backlog.md`, read and follow [references/backlog-dependency-map.md](references/backlog-dependency-map.md). Do not read it for reports without backlog tickets.

## Review the generated report

Before delivery:

1. Run `scripts/validate-report.mjs` from this skill directory against the completed report. Fix every unresolved placeholder, duplicate or missing local target, unsynchronized index item, and external runtime dependency it reports.
2. When the active repository already provides Playwright, run `scripts/render-report.mjs <report-path> ${TMPDIR:-/tmp}/agent-final-<report-id>-captures` from this skill directory while keeping the repository as the working directory. Always pass the ID-scoped capture directory explicitly rather than accepting the script's shared default. The script resolves Playwright from that repository, reports clipping or SVG-boundary problems, and captures the hero plus visually dense sections. Use `--all` only when prose-only section layout also needs inspection. Do not install browser or image dependencies solely to review the report.
3. Inspect the generated captures before the first delivery, not only after feedback. Check hierarchy, legibility, navigation, arrow direction and meaning, line wrapping, contrast in emphasized surfaces, and whether the first viewport communicates the result. Fix the report and rerun validation after every visual edit. If browser tooling is unavailable, disclose that limitation in the report.
4. Read the completed HTML report end to end as a reader, not only as source to validate. Identify the hero's central claim, then remove every later sentence, label, metric, or caption that merely repeats or paraphrases it. Remove unsupported claims, weak examples, decorative modules, and details that obscure the outcome.
5. Compare every visual example with the actual capture or source-derived output. If it is not faithful, replace it with better evidence or omit it.
6. Confirm each section has a clear dominant element, supporting surfaces are necessary, and visual density is proportionate to the amount of information. Narrow-screen optimization is not an acceptance criterion.

## Deliver it

The final response must contain only this Markdown link, with the absolute path substituted:

```markdown
[Open final report](file://<absolute-path>)
```

Do not include the HTML source, report body, summary, or other commentary in the response.
