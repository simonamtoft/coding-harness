---
name: blast-radius
description: Trace what a change could break beyond its diff. Use only when the user explicitly asks for blast-radius analysis, downstream-impact analysis, or what a change could break; do not use for routine code review.
---

# Blast-radius analysis

Perform a read-only downstream compatibility investigation. Follow the change past its visible diff, identify the few safety invariants on which it depends, and raise those invariants to executable evidence when practical.

Do not edit the repository or fix findings. Existing tests may be run unchanged. Put any one-off probe in the session temporary workspace, import or invoke the real project code, and remove no project data.

## Scope

Start from the supplied diff, commit range, files, or symbols. If the change under analysis is ambiguous and repository inspection cannot identify it, ask the user to specify it.

This workflow is distinct from routine correctness and security review:

- Use blast-radius analysis only for an explicit downstream-impact request.
- Use the harness's existing findings-only review mechanism (`review_changes` when available) when an independent review is also requested or required.
- Keep reviewer findings separate and unmodified. Do not ask a reviewer to produce this report, relabel blast-radius uncertainty as a review finding, or treat this workflow as a replacement for correctness or security review.

## Evidence levels

Assign one of these levels to every key safety invariant. The level measures evidence strength whether the invariant is true or false; report that verdict separately.

| Level | Evidence |
| --- | --- |
| E0 — asserted | A claim with no repository evidence. Never present it as settled. |
| E1 — located | Concrete source, pinned dependency code or documentation, history, or configuration supports the claim. Cite it. |
| E2 — traced | The relevant failure path was followed end to end and an enforced guard or unreachable condition rules it out. |
| E3 — executed | A focused test or script exercised the real shipped code and would fail if the invariant were false. Record the command and result. |
| E4 — observed | The behavior was reproduced in the running application or equivalent deployed integration. Record the observation. |

E3 is the normal target. Do not round E1 or E2 up to executable proof. E4 is useful only when practical and materially stronger than E3.

## Workflow

1. **Characterize the change.** Read the complete diff and enough surrounding code to state what behavior or contract changed, including additions, removals, and ordering changes that the patch does not describe directly.
2. **Trace direct consumers.** Follow callers, implementations, types, tests, registrations, generated bindings, and configuration. Search for old and new names, values, and serialized forms rather than only symbol references.
3. **Trace contracts that grep can miss.** Check every applicable boundary:
   - persisted rows, columns, migrations, files, caches, queues, and old data still in circulation;
   - request, response, event, CLI, environment, and other wire formats, including versioning and unknown-field behavior;
   - the exact pinned dependency version, local patches, and relevant dependency source or documented semantics;
   - initialization, scheduling, retries, cancellation, teardown, unmount, transaction, and shutdown ordering;
   - generated code and consumers in other languages, services, repositories, or runtimes visible from local references.
   Mark a boundary not applicable only after finding evidence that excludes it. A search with no matches is evidence, but record the search scope.
4. **Name the key safety invariants.** Choose the one or two facts that decide whether the change is safe. State each precisely enough that a test could fail when it is false, then assign its current evidence level.
5. **Classify what you found.** A confirmed risk has a demonstrated reachable failure path. A cleared risk was plausible but evidence rules it out. An unproven assumption is required for safety but lacks enough evidence; it is not a confirmed defect and must not be described as safe.
6. **Run focused proof when practical.** Prefer, in order, an existing focused test, a disposable script against the real project code and pinned dependency, or a narrow application probe. The probe must exercise the exact invariant and fail loudly if it is false. Record the command, output or assertion, and resulting evidence level. Do not add a repository test or fixture in this read-only workflow. If execution is unsafe, destructive, blocked by missing services or credentials, or disproportionate to the risk, do not run it; state the blocker and leave the invariant unproven at its attained level.
7. **Check the report against the evidence.** Verify every key claim has a citation, trace, or probe. Remove speculative risks with no plausible failure path. Preserve uncertainty where external or cross-repository consumers cannot be inspected.

## Report

Use this structure, omitting no section (write `None found` where appropriate):

```markdown
## Change and downstream map
<What changed and the important consumer/contract paths followed.>

## Safety invariants
| Invariant | Evidence level | Evidence | Status |
| --- | --- | --- | --- |
| ... | E0-E4 | file:line, trace, or probe | proven / disproven / unproven |

## Confirmed risks
- <Reachable breakage, affected consumer, likelihood, impact, and supporting evidence.>

## Cleared risks
- <Plausible breakage checked, evidence that rules it out, and evidence level.>

## Unproven assumptions
- <Safety assumption, why proof stopped, likely consequence if false, and cheapest next proof.>

## Executable proof
- Command/probe: `<exact command or application action>`, or `Not run — <specific reason>`
- Result: <observed output/assertion and which invariant it tests>

## Independent review findings
<Separate result from the harness's findings-only review mechanism when one was run; otherwise `Not run as part of this analysis`.>
```

Cite repository paths with line numbers where practical. For external contracts, identify the exact version and source inspected. Never invent a caller, consumer, guarantee, test result, or evidence level.
