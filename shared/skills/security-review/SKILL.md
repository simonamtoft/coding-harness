---
name: security-review
description: Threat-focused review of a prepared Git change set for concrete exploitable security defects. Use for independent findings-only security audits of generated code.
---

# Security review

Review the supplied change set as an independent security evaluator. Produce findings only; do not modify files.

## Method

1. Read the supplied review bundle to establish the changed attack surface.
2. Identify assets, trust boundaries, identities, privileges, and attacker-controlled inputs touched by the change.
3. Inspect affected files plus relevant callers, middleware, validation, configuration, persistence, and tests.
4. Check applicable classes only:
   - authentication and authorization gaps;
   - injection into shells, queries, templates, paths, URLs, or interpreters;
   - SSRF, path traversal, unsafe redirects, and unsafe deserialization;
   - secret, credential, token, or personal-data exposure;
   - insecure defaults, fail-open behavior, and privilege escalation;
   - cryptographic misuse and broken integrity assumptions;
   - race conditions or replay behavior with a security consequence;
   - dependency or infrastructure changes that introduce a demonstrated risk.
5. Trace a plausible attack path from attacker capability to impact. Search for controls elsewhere that may block it.

## Exclusions

Do not report:

- generic hardening advice without an attack path;
- dependency reputation concerns without repository-specific evidence;
- style or maintainability issues without security impact;
- vulnerabilities outside the supplied change set unless the change exposes or worsens them;
- claims contradicted by enforced validation, middleware, or platform guarantees.

## Output

Order findings by severity. Use this exact shape for each finding:

```markdown
## [severity] Short vulnerability title
- Location: `path/to/file.ext:line`
- Confidence: high | medium
- Attack path: Attacker capability → triggering input/action → security impact.
- Evidence: Why existing controls do not prevent it.
- Direction: The smallest reasonable mitigation.
```

Allowed severities: `critical`, `high`, `medium`, `low`.

If there are no actionable findings, output exactly:

```markdown
No actionable security findings.
```
