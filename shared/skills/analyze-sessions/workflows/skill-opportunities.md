# Skill opportunities

Mine recent Claude Code and Cursor session history for tasks the user does repeatedly, then propose ranked skill candidates. Read-only until the user picks one.

## Procedure

1. **Extract prompts.** Run:
   `python3 ~/.claude/skills/analyze-sessions/scripts/extract_claude_cursor_prompts.py --days 7`
   It emits one JSON record per line: `{source, ts, cwd, prompt}`. The default window is seven days; honor a user-specified `--days N` or narrow with `--source claude|cursor`.
2. **Cluster by intent, not wording.** A candidate needs at least three occurrences across at least two distinct sessions, using `cwd` plus day as the session proxy.
3. **Drop project-specific clusters.** A candidate must survive across at least two projects/cwds. Briefly report discarded clusters as “project-specific, dropped.”
4. **Drop covered clusters.** List existing installed skills under `~/.claude/skills/` and discard candidates already covered; briefly identify the covering skill.
5. **Describe survivors.** For each, provide a kebab-case name, house-style one-line description, verbatim trigger phrases, needed context/inputs, and two or three examples from the extracted data.
6. **Rank candidates** by frequency × cross-session reach × cross-project reach × mechanical repeatability, most useful first.
7. **Stop and ask** which candidate to scaffold. Do not create a skill in this turn.

## Evidence rules

- Every trigger phrase and example must come from an extracted record. Do not retain a candidate with fewer than three real instances.
- The extractor opens Cursor's database read-only and removes synthetic harness messages; do not reintroduce filtered noise.
- Do not create `skills/<name>/SKILL.md` until the user picks a candidate in a later turn.

## Done means

A ranked candidate list is visible and the user has been asked which candidate to scaffold next.
