---
name: primary-source-research
description: Investigate an external technical topic, API, standard, or upstream implementation using authoritative sources. Use for explicit research or substantial external-source legwork; not for ordinary repository reading, prose rewriting, or conversation-to-spec synthesis.
---

# Primary-source research

## Use when

Use for explicit research or substantial reading outside the active repository, such as official documentation, standards, release notes, upstream source, or a first-party service. Do not use it for ordinary local inspection, prose rewriting (`humanize-writing`), or conversation-to-specification synthesis (`to-spec`); those skills may use these findings.

## Investigation

1. State the research question, the decision it informs, and any time, version, platform, or compatibility boundary that could change the answer.
2. Start with primary sources, in this order where applicable:
   - official documentation, specifications, and RFCs;
   - first-party API references, release notes, and support guidance;
   - the authoritative source repository, issue tracker, or changelog.
3. Use a secondary source only when primary evidence is unavailable or insufficient. Label it as secondary and say why it was needed.
4. Cite each material claim directly: URL or repository reference; specific section, page, or line when available; and accessed version or date for mutable sources. Do not use search-result snippets as evidence.
5. Separate source-backed facts from conclusions. Label recommendations as inference and name their evidence and assumptions.
6. Report uncertainty, source conflicts, and gaps; do not fill them with plausible claims.

## Output and retention

Answer in the session by default and keep temporary material in the private session workspace. Persist research only when the user asks for an artifact or the findings must outlive the session:

1. Follow the destination repository's existing convention and read its instructions before creating material; do not invent a parallel notes layout.
2. For a designated research vault, first preserve the original source material or immutable reference and provenance, then follow its ingestion and linking rules for faithful extraction or cross-source synthesis. A named personal vault's `AGENTS.md` or `CLAUDE.md` and README are authoritative.
3. Without an existing convention, ask the user to approve a durable path. Do not silently create a research directory in the active project.

## Deliverable

Keep the result proportional to the question. Include:

- the answer or decision-relevant findings;
- cited source facts;
- clearly labeled inference or recommendation;
- important uncertainty or disagreement;
- the saved artifact location, if anything was retained.
