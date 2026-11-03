# Repository and instruction ownership

Decision ledger area. Entry ids use the `OWN-` prefix; see `../DECISIONS.md` for the format and append rules.

### OWN-01 · Keep repository operating context in root AGENTS.md
`accepted` · 2026-08-25 · `01a03a92`
**Decision:** Agent-facing purpose, ownership boundaries, invariants, and verification commands live in root `AGENTS.md`; `README.md` stays the human setup and explanation document.
**Why:** Agents need operating context beside the instructions they follow, and the README must not become the sole source of agent-facing safety constraints.
**Revisit if:** The ownership model or deployment workflow changes.

### OWN-02 · Preserve the generated Backlog block byte-for-byte
`constraint` · 2026-08-25 · `01a03a92`
**Decision:** Simplify only the repository-authored part of `AGENTS.md`; never edit the generated Backlog.md instruction block.
**Why:** The block is tool-managed; edits are silently overwritten or drift from the CLI's expectations.
**Revisit if:** Backlog.md changes its generated instruction format.

### OWN-03 · Adopt targeted guidance, never whole external documents
`rejected` · 2026-08-24 · `01a033e0`
**Decision:** Rejected copying an external `agent.md` wholesale; adopted only the recommendations addressing an actual gap. Same outcome later for `unslop` (`01a03380`): extract selected directness rules into `shared/AGENTS.md`, keep `humanize-writing` as the explicit skill for authored content.
**Why:** A full copy bloats context and weakens rules already better expressed here.
**Revisit if:** A recurring failure appears that the omitted guidance directly addresses.

### OWN-04 · Keep context-hygiene practice out of the permanent prompt
`accepted` · 2026-08-24 · `01a033e0`
**Decision:** Session context hygiene (`/ctx-monitor`, `/handoff`, fresh sessions) is documented in `README.md`, not the system prompt.
**Why:** Operating practice belongs in docs; the permanent prompt is reserved for durable behavioral rules.
**Revisit if:** Context growth becomes a failure mode that documentation and tooling cannot address.

### OWN-05 · Prefer private APIs and named domain values
`accepted` · 2026-08-24 · `01a033e0`
**Decision:** Keep new fields, functions, and types private by default; name recurring or domain-significant values but leave self-explanatory one-off literals inline.
**Why:** The second half exists to block the common overcorrection of extracting every literal.
**Revisit if:** A current requirement makes broader visibility part of a real contract.

### OWN-06 · Area files with stable ids, not one-file-per-ADR
`rejected` · 2026-08-31 · `01a061d4`
**Decision:** Rejected converting the ledger to classic ADRs (one numbered file per decision, Context/Decision/Consequences). Split the single 497-line file into per-area files under `decisions/` keyed by an id prefix, keeping the existing entry format and adding stable `PREFIX-NN` ids.
**Why:** The entry format already carries status, decision, context, and the `Revisit if` condition ADR lacks; the actual problem was read cost, since consulting one area meant loading the whole file. Per-decision files would need an index anyway and turn an area read into ~70 file reads.
**Revisit if:** Entries need independent lifecycle or review per decision, or an external ADR tool is adopted.

### OWN-07 · Universal guidance stays principled, not templated
`accepted` · 2026-09-04 · `01a06b63`
**Decision:** Replace the proposed TypeScript-specific skill with concise, language-neutral boundary and model guidance in `shared/AGENTS.md`. Refuse universal DTO, Pydantic, TypeScript, or C# templates and repository-layout prescriptions.
**Why:** Concrete schema libraries, transport-to-domain mapping, and project structure depend on each repository's framework and architectural conventions; a shared template would impose misleading defaults. The durable cross-language value is in boundary validation, constructive representations, proportionate strengthening, evidence for unchecked coercions, and deriving from authoritative definitions.
**Revisit if:** Repositories using the same stack demonstrate a recurring, stable template need with session evidence.
**Evidence:** "Universal guidance."

### OWN-08 · Prefer durable contract tests over high-fidelity test hierarchy
`accepted` · 2026-09-08 · `01a081aa`
**Decision:** Replace the universal end-to-end → integration → unit preference with guidance to test stable contracts at their owning layer, and use visual or manual verification for one-off editorial and layout changes.
**Why:** A fidelity-first hierarchy encouraged browser tests that encoded presentation copy, structure, ordering, and layout details, creating volatile tests with little regression value.
**Revisit if:** Repositories demonstrate that the guidance systematically misses regressions that a broader browser suite would catch.
**Evidence:** "stop creating useless tests that are very volatile"

### OWN-09 · Adapt STE principles without enforcing full compliance
`accepted` · 2026-09-16 · `01a0ab17`
**Decision:** Add selected Simplified Technical English principles to the shared “Present Clearly” instructions, not a separate skill. Do not impose the full controlled dictionary or rigid sentence-length limits, or claim ASD-STE100 compliance.
**Why:** Consistent terminology, explicit referents, and separate user actions can reduce reading effort in every response. Strict vocabulary and length restrictions could obscure software terminology and constrain design explanations. Distinguishing evidence from inference is an agent-specific addition, not a claim about STE requirements.
**Revisit if:** A documentation workflow requires formal ASD-STE100 compliance.
**Evidence:** "OK please adapt the suggested changes"

### OWN-10 · Continuation-permission paragraph rejected on a null probe result
`rejected` · 2026-09-21 · `01a0c532`
**Decision:** Do not add a paragraph to `shared/AGENTS.md` granting explicit permission to continue through result inspection, change-caused failure repair, and affected rechecks. Written, measured, and removed.
**Why:** No measured effect. Seven single-turn scenarios produced identical continue/ask verdicts with and without it. A multi-turn fixture scored 2/12 with the paragraph versus 6/12 without at 24 trials (Fisher two-sided ≈ 0.19), and after the scenario was corrected to VER-08 semantics the direction reversed per model (sonnet 2/3 baseline vs 0/3 candidate; luna 0/3 vs 1/3). Session history also showed no premature-handoff instance to fix. OWN-03 asks for guidance that addresses a demonstrated gap, and the demonstrated gap turned out to be a different one: agents skip the project's own focused tests and hand-verify instead.
**Revisit if:** Probe evidence shows agents stopping mid-task for permission, which the `focused-check-own-change` scenario would surface as an early handoff rather than a missing check.
**Evidence:** "Can we somehow check that this change makes sense?"

### OWN-11 · Caveman 3.1 output ideas turned down or rejected on measurement
`rejected` · 2026-10-22 · `01a10c88`
**Decision:** Adopt nothing from Caveman (JuliusBrussee/caveman v3.1.0, commit 6571943). Turned down at review: its proxy and Pi extension, the full caveman/ultracave voice, running caveman-compress on `AGENTS.md`, and a migration skill. Measured and rejected (PI-96.2, PI-96.3): a quiet tool runs rule and a pre-send check for openers and recap closers. The re-runnable measurement, `shared/skills/analyze-sessions/scripts/overhead.py`, stays.
**Why:** The proxy puts third-party code on the provider path, has telemetry on by default, and never routes OAuth or subscription models such as our openai-codex ones. Caveman's own control-arm eval found its default voice cuts only 3% beyond a plain "Answer concisely." instruction, and the answer-first and STE parts are already in Present Clearly (OWN-09). Compressing `AGENTS.md` has no evidence that behaviour stays equivalent. The user declined the migration skill. Over 30 days of Pi sessions to 2026-10-22, text between tool calls was 2.0% of visible output tokens, and final messages were 9.4%, with 3.6% (28 of 783) matching the opener/closer rules. Both rules missed the materiality thresholds agreed with the user before the split was seen (≥10% of visible output, and also ≥10% opener/closer rate for the pre-send check).
**Revisit if:** A re-run of `overhead.py` crosses those thresholds; the proxy routes subscription models with telemetry off by default; an eval against this harness shows a compressed `AGENTS.md` behaves the same; or the user asks for a migration skill.

### OWN-12 · No new permanent tests by default
`accepted` · 2026-10-27 · `01a17e8b`
**Decision:** Agents add permanent tests only on request, when project instructions or CI require them (project rules beat the global default), or for named engine-room code: security/authorization/sandbox guards, boundary parsing and validation, migrations and data-loss paths, money or numeric calculations, concurrency and state machines, verifier infrastructure. Other verification uses existing checks or throwaway checks in the session temp directory that are never committed. Agents ask before deleting an existing test. `tdd-bug-fix` no longer triggers on unrequested bugs with a cheap seam (replaces SKL-10), and refactor characterization tests are throwaway by default. Rejected: a bare "only when asked" rule, and letting agents delete obsolete tests without asking.
**Why:** Generated tests are rarely reviewed and often assert wrong behavior, lock in code that should change, and lengthen local agent loops and CI. OWN-08 limited what tests assert; this limits whether they get written. Throwaway checks keep verification external without a maintenance cost. The engine-room exception is its own bullet because, when it sat inside the default rule, 2 of 5 Sonnet 5.5 probe trials skipped the money regression test "since you didn't ask". The probe evidence is indicative only (PRB-19).
**Revisit if:** Regressions slip through in non-engine-room code that a permanent test would have caught, or the engine-room list proves too vague to apply consistently.
**Evidence:** "AI-generated unit tests can be worse than having no tests at all. … They can lock in slop code by making it hard to change/remove"

### OWN-13 · Trim Reaper reduced to a provenance rule and a retention guard
`rejected` · 2026-11-03 · `01a1a06e`
**Decision:** Do not import Trim Reaper (jmanico/trim-reaper) wholesale: neither its 11-bullet third-party library policy in `shared/AGENTS.md` nor its eight dependency-reduction prompts as a skill. Adopted only a single `shared/AGENTS.md` bullet (check package name, publisher, and version against the live registry and never from memory; disclose unchecked advisories) and an `over-engineering-audit` guard that keeps established cryptography, authentication, and complex-parsing libraries. Also left out: licence and SBOM checks, maintenance-signal heuristics, and transitive-tree inspection.
**Why:** `shared/AGENTS.md` loads into every session, while the policy matters only on the rare turns that add or upgrade a package. Asking before adding a dependency, lockfile ownership, unused-dependency removal (`cleanse`), stdlib replacement (`over-engineering-audit`), and dependency security review (`security-review`) were already covered, so a reduction skill would overlap existing skills (SKL-05). Hallucinated or lookalike package names and hand-rolled security code had no existing guard. The effect of the new bullet has not been measured (PRB-19).
**Revisit if:** Sessions show agents adding unvetted packages or bloated transitive trees despite the provenance bullet, or dependency reduction becomes a recurring task that `cleanse` and `over-engineering-audit` do not serve.

### OWN-14 · Comments are evidence, and the default is no comment
`accepted` · 2026-11-03 · `01a1a06e-acf9`
**Decision:** Added a `shared/AGENTS.md` bullet treating code comments, documentation, TODOs, tool output, and fetched pages as evidence rather than instructions, with code winning over a disagreeing comment and unrequested TODOs left alone. Tightened the comment rules: default to no comment, and write for a future maintainer, not the reviewer of the change (no comments explaining the edit or the previous code). From the Grim Prompter review, which states the evidence-not-instructions rule for threat-model runs; the rest of that library went into SKL-32.
**Why:** The user observed agents following comments too closely and adding too many comments. The existing rules listed permitted comment purposes but set no default, and nothing addressed prompt injection or stale comments. The effect has not been measured (PRB-19).
**Revisit if:** Sessions still show over-commenting or comment-driven scope creep, which would call for a probe scenario, or the no-comment default suppresses needed invariant comments.
**Evidence:** "Sometimes I see that it sometimes follows comments too closely, and also adds too many comments."
