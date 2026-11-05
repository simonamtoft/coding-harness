# Pi session queries

Query past Pi sessions stored under `~/.pi/agent/sessions/`. The included scripts are standard-library Python 3 programs and only read session files. They apply to Pi sessions only; do not use them as evidence about Claude Code or Cursor sessions.

Set the script directory once for the session:

```bash
PI_SESSION_SCRIPTS=~/.pi/agent/skills/analyze-sessions/scripts
```

## Choose the smallest query

| User need | Command |
| --- | --- |
| Total cost in the last 7 days | `python3 "$PI_SESSION_SCRIPTS/cost.py" --since 7d --by total` |
| Daily spend for 30 days | `python3 "$PI_SESSION_SCRIPTS/cost.py" --since 30d --by day` |
| Most expensive projects or sessions | `python3 "$PI_SESSION_SCRIPTS/cost.py" --since 30d --by project --limit 10` or `--by session` |
| Costs by model | `python3 "$PI_SESSION_SCRIPTS/cost.py" --since 30d --by model` |
| Find a past session about a topic | `python3 "$PI_SESSION_SCRIPTS/search.py" "topic" --since 60d` |
| Render the latest or identified session | `python3 "$PI_SESSION_SCRIPTS/show_session.py" --latest` or `--session <id-prefix>` |
| Inspect Pi prompting patterns | `python3 "$PI_SESSION_SCRIPTS/prompts.py" --since 30d --max-chars 1500` |
| Where assistant output and parent context go | `python3 "$PI_SESSION_SCRIPTS/overhead.py" --since 30d` (add `--cwd`, `--until`, `--json`) |
| Which skills are used, and which installed skills are not | `python3 "$PI_SESSION_SCRIPTS/skill_usage.py" --since 90d` |

Use `search.py --in user` to restrict a search to user prompts, `--regex` for regular expressions, and `show_session.py --include-subagents-content` only when subagent transcript content is necessary. Avoid rendering thinking or lengthy tool output unless it is directly relevant.

## Filters and subagents

All scripts support time (`--since`, `--until`), project (`--cwd`), model (`--model`), provider, session, result limits, minimum cost/messages, errors-only, and prompt-grep filters. Use `--help` for the complete options.

`cost.py` includes subagent cost by default because it represents actual spend. Prompt, search, and rendering tools exclude subagents by default because their user messages are agent-written task descriptions; opt in only when that is the requested subject.

## Output and context overhead

`overhead.py` is the before/after measurement for output-style instruction changes; re-run it unchanged so both pictures use the same method. Subagent transcripts are excluded by default. Its rules:

- **Missing usage.** An assistant message whose usage has no numeric `output`, or whose token counts are all zero (failed or aborted requests), is counted as missing and excluded from token sums. A message without a `reasoning` count goes to `unattributed` instead of visible output.
- **Output split.** Visible output is `output − reasoning`, apportioned within each message by character share between text and tool-call name plus JSON arguments. Text is *between tool calls* when its message also calls a tool, *final message* when the message stopped normally (`stopReason: stop`) without a tool call, and *other* otherwise (error, aborted, length). Shares are of visible output.
- **Openers and closers.** Each final message is split into sentences on `.`, `!`, `?` and line breaks, ignoring Markdown markers and segments without word characters. An opener is a first sentence matching `OPENER_RE` (plan announcements such as "I'll…", "Let me…", "First, I will…"). A closer is a last sentence that contains an offer matching `CLOSER_RE` ("let me know", "if you want", "want me to", "would you like", "feel free", "I can also", …) or starts with a recap lead-in ("In summary", "To summarize", "Overall", "TL;DR", …). The rules are English-only, and they also match genuine closing questions.
- **Subagent context.** Parent-context tokens are estimated as characters / 4 of each `subagent` tool result. Single and chain results count toward the last result's agent; parallel results are split on their `### [agent]` sections. Subagent calls made from `codemode` are counted but not attributed, because their output is mixed into the script result.
- **Bash limiter.** A Bash result counts as truncated when it ends with the limiter marker `[Bash output truncated: N bytes; full output: …]`; the original size is `N` and the retained size is the result's UTF-8 length. Pi's own truncation without the limiter is not counted.

## Skill usage

`skill_usage.py` counts a skill as used in a session when the user invokes it with `/skill:name` (*explicit*) or the model reads its `SKILL.md` under a Pi skill location: `~/.pi/agent/skills`, `.pi/skills`, `~/.agents/skills`, or `.agents/skills` (*loads*). Reads of other files in the skill directory are *resources* and do not make a session count as a use. The report lists installed skills under `~/.pi/agent/skills` with no use in scope, and skill names that were used but are no longer installed.

The counts are lower bounds. They miss skills loaded through `bash` or `codemode`, and skills loaded by subagents, which run without session files. They also exclude reads of a skill's source checkout (for example `shared/skills/...`), because those are usually edits. Zero use in the chosen window is evidence for review, not proof that a skill is useless. Check that explicit-only and rarely needed skills fit the window before you propose retiring them.

## Reporting

State the query scope and filters, distinguish measured values from interpretation, and identify unavailable or unmatched session data. For a request to turn recurring work into a reusable skill, return to the **skill opportunities** workflow instead of inventing candidates from an unqualified Pi prompt dump.
