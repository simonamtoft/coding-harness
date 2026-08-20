---
name: humanize-writing
description: Rewrite text to remove formulaic AI-writing patterns while preserving meaning, facts, tone, and the author's voice. Use when the user explicitly asks to humanize, de-AI, de-slop, or make writing sound less like ChatGPT.
---

# Humanize writing

Edit writing that feels generic, inflated, mechanical, or recognizably chatbot-like. The goal is not to make every text casual or quirky. It is to make the text sound like a person wrote it for its actual audience and purpose.

Style is not proof of authorship. Do not claim that the source was written by AI or that the rewrite will evade AI detectors.

## Preservation contract

- Preserve the original meaning, factual claims, uncertainty, citations, and important terminology.
- Never invent evidence, sources, quotations, personal experiences, opinions, or concrete details.
- Match the requested audience, register, dialect, and level of formality. Infer them from the text when they are clear.
- Retain the author's existing voice where possible instead of replacing it with a generic conversational voice.
- Preserve deliberate structure and formatting unless they contribute to the problem or the user asks to change them.
- Do not alter quoted material, code, identifiers, citations, or legal wording without instruction.
- Prefer the smallest edit that solves the problem.

## Editing modes

Use a light edit unless the user requests a substantial rewrite.

- **Light edit:** Remove filler, repetition, canned phrasing, and distracting stylistic habits while retaining the original structure and voice.
- **Full rewrite:** Restructure sentences or paragraphs for flow and clarity while preserving the substance and intended tone.

## Workflow

1. Determine the text's purpose, audience, tone, and requested editing depth.
2. Identify patterns that materially make the writing feel formulaic. Do not flag words or punctuation in isolation.
3. Rewrite only as much as needed.
4. Audit the result internally:
   - Did any fact, implication, level of certainty, or point of view change?
   - Was any detail, source, experience, or opinion added?
   - Does the result fit the original audience and register?
   - Did the rewrite merely swap one formula for another?
5. Return the final rewrite. Explain the changes or show alternatives only when requested.

## Patterns to check

Treat these as diagnostic signals, not banned forms. A word, em dash, list, or three-part sentence may be natural in context. Edit patterns when they are repetitive, unsupported, or poorly matched to the text.

### Inflation and promotion

Remove exaggerated claims of significance, legacy, transformation, or excellence when the text does not support them. Replace abstract praise with concrete information already present in the source.

Common signals include "pivotal," "vibrant," "groundbreaking," "testament," "evolving landscape," "stands as," and generic claims about a bright future.

### Vagueness and fake depth

Watch for vague authorities, unsupported generalizations, and trailing participial phrases that pretend to explain significance: "experts argue," "reflecting broader trends," "highlighting its importance," or "ensuring better outcomes."

Keep genuine uncertainty. Do not manufacture specificity to replace a vague claim; if the source lacks support, make the claim more modest or remove it when its removal preserves the meaning.

### Formulaic structure

Break up repeated sentence shapes, forced contrasts, false ranges, synonym cycling, and lists padded to groups of three. Remove canned sections such as generic "challenges and future prospects" conclusions when they add no information.

Vary rhythm when useful, but do not add fragments, jokes, tangents, or deliberate errors merely to appear human.

### Indirect and padded language

Prefer clear verbs and ordinary constructions over elaborate substitutes:

- "serves as" → "is"
- "has the ability to" → "can"
- "due to the fact that" → "because"
- "it is important to note that" → state the point directly

Reduce stacked hedges, but preserve the source's actual uncertainty. Avoid repeatedly replacing simple terms with synonyms just to prevent repetition.

### Mechanical presentation

Fix formatting only when it feels templated or obstructs the prose: decorative emoji bullets, excessive bold labels, repetitive inline headings, or uniform paragraph construction. Do not automatically strip em dashes, curly quotes, title case, bullets, or bold text when they suit the document's style.

### Chatbot residue

Remove conversational scaffolding that is not part of the content, such as "Great question," "Here is an overview," "I hope this helps," or offers to continue. Remove knowledge-cutoff disclaimers when they are irrelevant, but retain meaningful date qualifications and source limitations.

## Examples

### Replace inflation with concrete meaning

**Before:**
> The institute was established in 1989, marking a pivotal moment in the evolution of regional statistics and reflecting a broader shift toward decentralized governance.

**After:**
> The institute was established in 1989 to collect and publish regional statistics independently from the national statistics office.

### Remove superficial analysis without inventing support

**Before:**
> The redesign uses blue and green throughout, creating a cohesive visual identity while highlighting the organization's deep connection to the coast.

**After:**
> The redesign uses blue and green throughout. The organization chose those colors to reference the coast.

Use the second version only if the source actually attributes the choice to the organization. Otherwise write: "The redesign uses blue and green throughout."

### Remove chatbot scaffolding and filler

**Before:**
> Great question! Here is a quick overview. It is important to note that the policy could potentially affect contractors as well as employees. I hope this helps, and let me know if you would like more detail.

**After:**
> The policy may affect contractors as well as employees.

### Preserve the intended register

**Before:**
> It is important to note that the proposed migration could potentially introduce several significant operational challenges.

**Too casual:**
> Honestly, the migration could get pretty messy.

**Better:**
> The proposed migration may introduce operational risks.

Human writing is not always informal. Technical, academic, legal, and corporate prose should remain appropriately precise and restrained.

## Reference

The diagnostic categories are informed by Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup. That catalogue focuses heavily on encyclopedia writing, so apply its observations according to the current text's genre rather than as universal prohibitions.
