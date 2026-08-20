---
name: create-skill-from-session-data
disable-model-invocation: true
description: Use when the user asks which recurring tasks in their recent sessions should become skills. Analyzes both Claude Code transcripts and Cursor chat history, then proposes ranked skill candidates and waits for the user to pick one before scaffolding.
---

# Create skill from session data

Mine recent Claude Code and Cursor session history for tasks the user does repeatedly, and propose ranked skill candidates. Read-only until the user picks one.

## When this triggers

- "Based on my recent sessions, what tasks am I doing repeatedly that should be skills instead of one-off prompts?"
- "What should I turn into a skill"
- "Find skill opportunities in my history"
- "Audit my prompts for repeats"
- "Any patterns in my recent work that deserve a skill"

## Procedure (in this order)

1. **Extract prompts.** Run the helper script:
   `python3 ~/.claude/skills/create-skill-from-session-data/scripts/extract_sessions.py --days 7`
   It emits one JSON record per line: `{source, ts, cwd, prompt}` covering both Claude Code and Cursor. Default window is 7 days — override with `--days N` if the user asks for more/less, or narrow with `--source claude|cursor`.
2. **Cluster by intent, not by wording.** Group prompts by *what the user was trying to accomplish*, not by lexical similarity. A cluster only qualifies as a candidate if it has **≥3 occurrences across ≥2 distinct sessions** (use `cwd` + day as the session proxy).
3. **Drop project-specific clusters.** If the candidate's triggers, examples, or required context only make sense inside one repo/cwd, drop it — skills are durable, the user's short-lived projects aren't. Internal service names, project-specific paths, and company-internal tooling are red flags. A surviving candidate must show triggers from **≥2 distinct projects/cwds**. Mention dropped ones briefly as "project-specific, dropped".
4. **Drop already-covered clusters.** List existing skills under `~/.claude/skills/` and discard any candidate whose intent is already covered. Mention dropped ones briefly as "already covered by `<skill>`".
5. **Describe each remaining candidate.** For each, produce:
   - Proposed skill name (kebab-case)
   - One-line description in the house style (see `compare-implementations`, `triage-error`)
   - Trigger phrases lifted verbatim from real prompts
   - Context/inputs the skill would need (files, env, prior tool output)
   - 2–3 example prompts pulled from the data
6. **Rank most → least useful.** Score by frequency × cross-session reach × cross-project reach × how mechanical the task is (more mechanical = better skill candidate). Output a numbered markdown list.
7. **Stop and ask which to scaffold.** End the turn with a single question naming the top candidates. Do not write any skill files yet.

## Rules

- **Read-only this turn.** Never create `skills/<name>/SKILL.md` files until the user picks one — that's the next turn.
- **No hallucinated examples.** Every trigger phrase and example prompt must come from the extracted records. If a candidate doesn't have ≥3 real instances, drop it.
- **Don't re-propose existing skills.** Cross-checking against `~/.claude/skills/` is mandatory, not optional.
- **Cursor DB is read-only.** The script opens it with `mode=ro`; never write to it.
- **Skip noise.** The script already filters `<system-reminder>`, tool results, and command caveats — don't try to surface those as prompts.

## Done means

A ranked list of candidate skills is on screen, each backed by real prompts, and the user has been asked which one to scaffold next.
