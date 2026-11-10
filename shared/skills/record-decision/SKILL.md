---
name: record-decision
description: Record an architecture or design decision (ADR) after it has been made. Use when the user asks to write, record, or amend an ADR or decision record, or when technical-design, domain-modeling, or a prototype settles a decision worth recording. Not for proposing or evaluating the design itself.
---

# Record a decision

Write down *that* a decision was made and *why*, in the place the project keeps its decisions. The output is one new or amended decision record and its id or path. Designing the decision belongs to `/technical-design` or `/domain-modeling`; start here once the choice is made.

## 1. Check that it deserves a record

Record a decision only when all three hold:

1. **Hard to reverse.** Changing your mind later costs something real.
2. **Surprising without context.** A future reader would ask "why did they do it this way?"
3. **A real trade-off.** There were genuine alternatives and one was chosen for specific reasons.

Also record one when the project's own instructions require it for the change, for example a change to persistence, a public API, a trust boundary, or infrastructure layout.

Typical qualifiers: architectural shape, integration patterns between contexts, technology choices with lock-in, ownership and scope boundaries (including explicit no's), deliberate deviations from the obvious path, constraints not visible in code, and non-obvious rejected alternatives. If any criterion fails and no project rule demands it, say so and record nothing.

## 2. Find the store

Use the first that applies:

1. **The project's instructions name a location or format** (`AGENTS.md`, `CLAUDE.md`, a contributing guide). Follow them exactly, even when they differ from the defaults below.
2. **The code already has a `docs/adr/` history** and no instruction says to move it. Keep using it, so the history stays in one place.
3. **The code belongs to a Backlog.md project** (a `backlog/` folder at its root; run `backlog` from that folder). Use Backlog decisions.
4. **Otherwise**, create `docs/adr/` next to the code the decision governs.

In a repository with several bounded contexts or projects, record the decision in the one it governs. Link records in other contexts by relative path or decision id rather than duplicating them.

## 3. Check for related records

Search before writing, so a new record does not silently contradict an old one:

- Backlog: `backlog search "<topic>" --plain` and `backlog decision list --plain`.
- `docs/adr/`: list the folder and read the records whose titles touch the topic.

If an existing record covers the same question, amend it rather than adding a near-duplicate. If the new decision replaces part or all of one, plan the supersession in step 5.

## 4. Write the record

Keep it short. A few sentences per section is normal; omit a section rather than padding it.

```md
## Context
Source: <task id, issue, or PR, when one exists>
<The forces and constraints that made a decision necessary.>

## Decision
<What was chosen, stated as a rule a reader can follow, including what was refused.>

## Consequences
<What becomes easier or harder, follow-up work, and what would justify revisiting.>
```

Add `## Alternatives considered` only when a rejected option is likely to be proposed again.

### Backlog decisions

1. Create it with the CLI, which assigns the id, date, and frontmatter: `backlog decision create "<title>" -s accepted --plain`. Use `-s proposed` when the user has not approved the decision yet.
2. Open the file it reports under `backlog/decisions/` and fill the empty `## Context`, `## Decision`, and `## Consequences` sections with the edit tool. Backlog's CLI cannot write a decision body, so this is the one sanctioned direct edit of a Backlog file. Never change the frontmatter by hand: id, title, date, and status stay CLI-owned.
3. When a task produced the decision, add the reference to the task with the CLI: `backlog task edit <task-id> --add-ref <decision-file-path>`.

### `docs/adr/` files

Name the file `NNNN-short-title.md`, one above the highest number in that folder, zero-padded to four digits. Start it with `# <Title>`, then a `Status: accepted` line (or `proposed`), then the sections above. Create the folder only when writing its first record.

## 5. Supersede or amend

When the new decision replaces an old one:

- **Backlog:** set the old status with `backlog decision edit <old-id> -s "superseded by <new-id>"`. That command needs Backlog 1.55 or later; on older versions, leave the status and say so in your report. In either case, add a line under the old record's `## Decision` naming the replacement.
- **`docs/adr/`:** change the old record's status line to `superseded by NNNN` and link the new file.

When the new decision changes only part of an old one, amend the old record's affected section in place and note the newer record there, so neither record reads as current where it is not.

## 6. Report

State the id or path of each record created or amended, and the store chosen with the step-2 rule that selected it. Mention any supersession left incomplete.
