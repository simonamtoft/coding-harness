---
name: to-spec
disable-model-invocation: true
description: Turn the current conversation into a specification and publish it as a Backlog.md task — no interview, just synthesis of what has already been discussed.
---

# To Spec

Synthesize the current conversation and codebase understanding into a specification (also known as a PRD), then publish it as a Backlog.md task. Do not start a fresh requirements interview; use what is already known.

## Process

1. Explore the repository if needed. Use the project's domain vocabulary (see `/domain-modeling` and any `CONTEXT.md`) and respect relevant ADRs.

2. Sketch the seams at which the feature will be tested. Prefer existing seams and the highest practical seam; introduce as few new seams as possible. Confirm that the proposed seams match the user's expectations.

3. Write the specification with the template below.

4. Before publishing, run `backlog instructions task-creation`. Create one Backlog task whose description contains the completed specification:

   ```bash
   backlog task create "<spec title>" --type task --description "<completed specification>" --plain
   ```

   Pass multiline Markdown as a real multiline argument as documented by `backlog task create --help`; do not edit a Backlog Markdown file directly.

   If this specification came from a `/wayfinder` map, create it as a child with `--parent <mapTaskId>`. Do not add speculative labels or tracker setup.

<spec-template>

## Problem Statement

The problem the user faces, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User Stories

A numbered list of user stories in this form:

1. As an <actor>, I want <feature>, so that <benefit>.

Cover the feature's meaningful user-visible behavior without padding the list with implementation details.

## Implementation Decisions

The decisions already made, such as:

- modules or interfaces that will change
- technical clarifications
- architectural or schema decisions
- API contracts
- important interactions

Do not include specific file paths or code snippets because they go stale quickly.

Exception: if a prototype produced a small snippet that captures a decision more precisely than prose can, inline only the decision-rich part and identify it as prototype evidence.

## Testing Decisions

Include:

- the observable behavior tests should protect
- the modules or system seams to test
- similar tests already present in the repository

## Out of Scope

What this specification deliberately excludes.

## Further Notes

Any remaining context needed to interpret the specification.

</spec-template>

The natural next step is `/to-tickets` against the created task.
