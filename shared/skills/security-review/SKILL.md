---
name: security-review
description: Threat-focused review of a prepared Git change set for concrete exploitable security defects. Use for independent findings-only security audits of generated code.
---

# Security review

Independent, findings-only security review of a prepared change set. The review itself never modifies files.

`SECURITY-REVIEWER.md` in this skill directory is the reviewer brief: the threat method, exclusions, and required finding shape. Read it and follow it when performing the review, whether you are the dispatched reviewer or reviewing directly.

## Dispatch

The `security-reviewer` role owns this brief.

- **Pi:** `review_changes` with `security: true` prepares the bundle and dispatches `security-reviewer`, which reads the same brief.
- **Claude Code:** review directly against the brief, or invoke `Task` with a read-only subagent type and a prompt naming the bundle path and this brief.

Run it only for changes affecting authentication, authorization, secrets, cryptography, untrusted input, network or filesystem trust boundaries, dependency security, or security configuration — or when the user explicitly asks.
