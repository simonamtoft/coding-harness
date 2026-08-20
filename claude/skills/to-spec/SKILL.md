---
name: to-spec
disable-model-invocation: true
description: Turn the current conversation into a spec and publish it as an FP issue — no interview, just synthesis of what you've already discussed.
---

# To Spec

This skill takes the current conversation context and codebase understanding and produces a spec (you may know this document as a PRD) and publishes it to the FP tracker. Do NOT interview the user — just synthesize what you already know.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain vocabulary throughout the spec (see `/domain-modeling` and any `CONTEXT.md`), and respect any ADRs in `docs/adr/` for the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better — the ideal number is one.

   Check with the user that these seams match their expectations.

3. Write the spec to a file using the template below, then publish it to FP by passing the file path — `fp issue create --body <file>` reads the file's contents:

   ```bash
   fp issue create --title "<spec title>" --body spec.md
   ```

   If this spec came out of a `/wayfinder` map, parent it to the map: add `--parent <mapId>`.

   Apply a triage label so the ticket is grabbable — default `--property labels=ready-for-agent`. Swap in whatever triage vocabulary the project actually uses (label values are free-form; `fp guide` confirms the `labels` property is registered but does not enumerate values — you pick the value). If `fp guide` shows no registered `labels` property, omit the flag entirely — FP errors on an unregistered property, and the label is only a triage convenience.

   Note on bodies (verified against this `fp` version): `create --body <file>` reads the file; `--body=-` reads stdin via a pipe; a bare `--body -` (space) is rejected. `<` redirect and `$(...)` misbehave with `fp`. Write the spec file with your editor rather than a `cat <<EOF` heredoc (the bash hook blocks heredocs).

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>

Once published, the natural next step is `/to-tickets` against this spec to slice it into implementation tickets.
