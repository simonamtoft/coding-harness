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

Use `search.py --in user` to restrict a search to user prompts, `--regex` for regular expressions, and `show_session.py --include-subagents-content` only when subagent transcript content is necessary. Avoid rendering thinking or lengthy tool output unless it is directly relevant.

## Filters and subagents

All scripts support time (`--since`, `--until`), project (`--cwd`), model (`--model`), provider, session, result limits, minimum cost/messages, errors-only, and prompt-grep filters. Use `--help` for the complete options.

`cost.py` includes subagent cost by default because it represents actual spend. Prompt, search, and rendering tools exclude subagents by default because their user messages are agent-written task descriptions; opt in only when that is the requested subject.

## Reporting

State the query scope and filters, distinguish measured values from interpretation, and identify unavailable or unmatched session data. For a request to turn recurring work into a reusable skill, return to the **skill opportunities** workflow instead of inventing candidates from an unqualified Pi prompt dump.
