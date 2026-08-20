---
description: Run independent correctness and security reviews of the current Git changes
argument-hint: "[base-ref]"
---

Run a findings-only review of the current repository changes relative to `${1:-AUTO}`. Do not edit source files or apply fixes.

1. Call `review_changes` exactly once. If the requested base above is `AUTO`, omit the tool's `base`; otherwise pass the requested base. Leave `focus` empty so this explicit audit covers the entire change set.
2. Reconcile the two results without inventing new findings. Deduplicate only when both reviewers identify the same root cause at the same location. Preserve severity, confidence, evidence, and source reviewer.
3. Present critical/high findings first, then medium/low findings. If both reviewers report no actionable findings, say so explicitly.
4. Do not apply fixes. Ask the user which findings, if any, they want addressed.
