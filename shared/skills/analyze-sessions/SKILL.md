---
name: analyze-sessions
disable-model-invocation: true
description: Use when the user asks to query or search Pi session history, identify recurring work that should become a skill, or retrospectively analyze a completed agent session for durable repository improvements. Routes to the matching read-only workflow.
---

# Analyze sessions

Select exactly one workflow below. All workflows are read-only except for their stated temporary report artifact. Never substitute Git history for session-transcript evidence.

## Select the workflow

1. **Pi session queries** — use `workflows/pi-session-queries.md` for Pi session cost, project/model/day rollups; listing or rendering a past Pi session; searching Pi transcripts; or dumping Pi prompts to inspect general patterns.
2. **Skill opportunities** — use `workflows/skill-opportunities.md` when the user asks which repeated work across their recent history should become a reusable skill. This workflow reads Claude Code and Cursor prompts and ends by asking the user which candidate to scaffold.
3. **Repository retrospective** — use `workflows/repository-retrospective.md` only when the user explicitly asks to reflect on a completed agent session to find durable improvements for its repository. This workflow writes one HTML report in the session temporary workspace and requires later approval for any follow-up changes.

If a request could fit more than one workflow, choose **skill opportunities** only when the requested outcome is a new skill; choose **repository retrospective** only when the requested outcome is process or repository improvement from one completed session; otherwise choose **Pi session queries**. Ask for clarification when the request does not establish an outcome or applicable session store.

## Shared rules

- Session data may contain sensitive prompts, tool output, and paths. Read only the minimum scope needed and do not paste unrelated transcript content into the response.
- Keep the analysis scoped to the selected session store. Pi, Claude Code, and Cursor histories have distinct formats and coverage; do not claim one represents another.
- Preserve each workflow's output contract and stopping point. Do not turn a read-only analysis into edits, task creation, or skill scaffolding without the approval required by that workflow.

## Included tools

- `scripts/cost.py`, `prompts.py`, `show_session.py`, and `search.py` query Pi JSONL sessions under `~/.pi/agent/sessions/`; their shared parser is `scripts/sessions.py`.
- `scripts/extract_claude_cursor_prompts.py` emits recent Claude Code and Cursor user prompts as JSONL for the skill-opportunity workflow.

The Pi query scripts were adapted from [amosblomqvist/pi-config analyze-sessions](https://github.com/amosblomqvist/pi-config/tree/main/skills/analyze-sessions) and use only Python's standard library.
