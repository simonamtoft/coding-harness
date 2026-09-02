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
