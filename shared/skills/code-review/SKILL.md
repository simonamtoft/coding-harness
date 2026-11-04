---
name: code-review
description: Review a prepared Git change set for concrete correctness, integration, and maintainability defects. Use for independent findings-only review of generated code.
---

# Code review

Independent, findings-only review of a prepared change set. The review itself never modifies files.

`CORRECTNESS-REVIEWER.md` in this skill directory is the reviewer brief: the method, exclusions, and required finding shape. Read it and follow it when performing the review, whether you are the dispatched reviewer or reviewing directly.

## Dispatch

The `correctness-reviewer` role owns this brief.

- **Pi:** `subagent` review mode prepares the bundle with `scripts/prepare-review.sh` and dispatches `correctness-reviewer`, which reads the same brief. Do not dispatch it by hand for a change already covered by that flow.
- **Claude Code:** review directly against the brief, or invoke `Task` with a read-only subagent type and a prompt naming the bundle path, the change's intent, and this brief.

## Verifier changes

`VERIFIER-CHANGE-REVIEWER.md` is the brief for the `verifier-change-reviewer` role. It decides whether an agent's change to the project verifier or its tests weakens the checks.

- **Pi:** `verify-turn` requests this review automatically before it runs a verifier whose entry point differs from the session's accepted content; the `subagent` extension prepares the bundle and dispatches the role. Do not dispatch it by hand.
- **Claude Code:** not wired; the Claude verify hook does not review verifier changes.

Scope, deferral, and when a security review runs alongside are decided by the review policy in the global instructions, not by this skill.
