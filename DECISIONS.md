# Decision ledger

Durable record of decisions taken in this repository, weighted toward what would otherwise be re-proposed: approaches that were **rejected**, directions that were **reverted**, standing **constraints**, and accepted choices whose **rationale is not recoverable** from the resulting code.

Git records what was accepted. This file records what was tried, refused, and why.

Entries live in `decisions/`, one file per area. Read only the area your change touches.

| Area | File | Ids | Owning paths |
| --- | --- | --- | --- |
| Repository and instruction ownership | `decisions/ownership.md` | `OWN-` | `AGENTS.md`, `shared/AGENTS.md`, `README.md` |
| Sandbox and command safety | `decisions/sandbox.md` | `SBX-` | `pi/agent/extensions/sandbox`, `shared/command-safety.tsv`, `claude/hooks/check-bash.sh` |
| Verification loop | `decisions/verification.md` | `VER-` | `pi/agent/extensions/verify-turn`, `pi/agent/extensions/diagnostics`, `claude/hooks/verify-turn.sh` |
| Subagents and review | `decisions/subagents.md` | `SUB-` | `pi/agent/agents`, `pi/agent/extensions/subagent`, `shared/skills/code-review`, `shared/skills/security-review` |
| Clarification UI | `decisions/clarification-ui.md` | `ASK-` | `pi/agent/extensions/ask-question` |
| Extensions and repository layout | `decisions/extensions.md` | `EXT-` | `pi/agent/extensions`, `pi/agent/packages.txt`, `link.sh`, `claude/` |
| Skill boundaries | `decisions/skills.md` | `SKL-` | `shared/skills` |
| Reports | `decisions/reports.md` | `REP-` | `shared/skills/present` |
| Backlog workflow | `decisions/backlog.md` | `BKL-` | `backlog/` |

## Using this ledger

- Consult the area file matching your change before proposing it. If an entry already refuses your approach, do not re-propose it without meeting its `Revisit if` condition.
- Append a new entry when a decision is rejected or reversed, when the user overrules a design direction, or when accepted rationale would be lost. Add it to the matching area file; create a new area file and index row if none fits.
- Do not record routine implementation steps, decisions evident from the artifact itself, or anything already enforced by a hook, type, or test.
- Entries are historical. Amend an entry only to mark it superseded, and say what replaced it — reference the replacement by id, for example `Superseded by SBX-14`.

## Entry format

```
### <PREFIX>-<NN> · <Decision title>
`accepted|rejected|reverted|constraint` · <date> · `<session id>`
**Decision:** what was decided, including what was refused.
**Why:** the reasoning that the resulting code does not carry.
**Revisit if:** the condition under which the decision should be reconsidered.
**Evidence:** optional verbatim user statement.
```

Ids are stable and never reused: number each new entry one above the highest existing id in that area file, even if earlier entries were superseded.

Backfilled 2026-08-31 from all 64 Pi sessions for this repository (2026-08-20 → 08-31). Session ids are truncated to their unique prefix; render one with `python3 shared/skills/analyze-sessions/scripts/show_session.py --session <id>`.
