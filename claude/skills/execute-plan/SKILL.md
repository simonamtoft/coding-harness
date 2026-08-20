---
name: execute-plan
description: Use when the user attaches a plan file and asks the agent to implement it, or when the user's message contains the boilerplate "Implement the plan as specified" / "To-do's from the plan have already been created". Codifies the user's standard plan-handoff protocol with an added escape hatch for wrong todos.
---

# Execute an approved plan

Implement a plan file that has already been written and approved, using the todos that were created alongside it.

## When this triggers

- User attaches a plan file (typically under `~/.claude/plans/`) and says implement / execute / do this
- User's message contains "Implement the plan as specified" or "To-do's from the plan have already been created"
- User says "go ahead with the plan" referencing a recent plan file

## Procedure

1. **Read the plan file** end to end before starting. Don't begin executing on partial understanding.
2. **List existing todos.** They were created when the plan was approved. Don't recreate them.
3. **For each todo, in order:**
   - Mark `in_progress` before starting work
   - Do the work the todo describes
   - Mark `completed` immediately when done (don't batch)
4. **Run to completion** without pausing between todos for confirmation, unless a rule below fires.
5. **Final summary:** one sentence on what changed and any follow-ups.

## Rules

- **Do not edit the plan file.** It's the source of truth for what was agreed. If the plan needs updating, ask first.
- **Do not recreate todos.** They already exist. If a todo seems missing, check the existing list before adding.
- **Mark `in_progress` / `completed` one-at-a-time.** Don't have multiple `in_progress` todos and don't batch completions.
- **Print commands, don't execute them.** Any shell commands the plan implies are printed for the user to run, unless they've explicitly authorised execution in this session. Only read-only lookups are exempt.
- **Escape hatch — wrong todo:** if while executing you discover a todo is wrong (premise no longer holds, instruction would cause harm, dependency missing), **stop and ask the user**. Don't silently rewrite the plan. Don't skip the todo. Don't fudge a workaround that diverges from the plan.

## Done means

- Every todo is `completed`.
- The plan file is untouched.
- A one-sentence summary of what was done, plus any todos that surfaced new follow-ups for a future plan.
