---
name: simplify-skill
disable-model-invocation: true
description: Use only when the user explicitly asks to simplify, tighten, or make an existing agent skill more concise or MECE. Rewrites the target SKILL.md while preserving its behavioral contract.
---

# Simplify a skill

Reduce a skill's complexity without changing what it does.

## Scope

The user must identify one target skill. If the target is missing or ambiguous, ask before proceeding. Edit only that skill unless the user approves broader changes. If the user asks for an audit or review only, return findings without editing.

## Procedure

1. Read the complete target `SKILL.md` and any files it directly relies on.
2. Record the behavioral contract before editing:
   - trigger and invocation controls;
   - inputs, scope, and prerequisites;
   - required steps, ordering, branches, and stop conditions;
   - safety boundaries, side effects, and approval gates;
   - output format, exact literals, paths, and completion criteria.
3. Find complexity that can be removed:
   - rules repeated in frontmatter or multiple sections;
   - categories that overlap, mix different axes, or omit likely cases;
   - precedence implied across separate paragraphs;
   - long prose that adds no testable behavior;
   - examples or explanations that restate an adjacent rule;
   - headings or abstractions that do not improve navigation.
4. Choose the smallest rewrite that addresses the findings:
   - state each rule once at its point of use;
   - separate independent classification axes, or use an ordered first-match decision when exactly one result is required;
   - put the main path in execution order and keep exceptions beside the affected step;
   - prefer direct instructions over commentary about the instructions;
   - retain examples only when they disambiguate behavior.
5. Stop and ask the user if simplification requires changing behavior, weakening a guardrail, choosing between plausible contracts, or editing another file. Do not silently resolve product or safety decisions.
6. Apply the rewrite, then inspect the complete diff. Remove no requirement merely to reduce the word count.

Do not apply generic style bans. Punctuation, headings, lists, repeated terms, and detailed explanations may be necessary. Optimize for a smaller and clearer behavioral specification, not minimal prose.

## Verification

- Compare before and after line and word counts. Treat them as measurements, not targets.
- Confirm every recorded contract item remains present or is expressed more precisely.
- Confirm the frontmatter remains valid and invocation controls are unchanged unless the user explicitly requested a change.
- Check that classifications are mutually exclusive and collectively exhaustive where the workflow requires one outcome. Use explicit precedence when cases can overlap.
- Run repository checks that apply to skill files and inspect `git diff --check`.

If no safe simplification exists, leave the file unchanged and explain why.

## Response

Report:

- the target path;
- line and word-count deltas;
- what was consolidated or reordered;
- any deliberate non-changes needed to preserve behavior;
- checks run and their results.
