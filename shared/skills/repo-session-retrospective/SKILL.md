---
name: repo-session-retrospective
disable-model-invocation: true
description: Use between sessions to analyze the most recently completed agent session for the current repository and recommend repo updates that would have prevented wrong turns or helped the agent reach the goal faster. Read-only; writes findings to a temporary HTML file and outputs only a clickable link.
---

# Repo session retrospective

Analyze the most recently completed session for the current repository. Find places the agent went in a wrong direction, only to later figure out the right way. Recommend what the user could have added to the repository that would have helped the agent reach its goal faster. Write the report as a single, self-contained HTML page to `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/repo-session-retrospective.html`. Do not include the report or any other commentary in the response. Output only a Markdown link in the form `[Open repo session retrospective](file://<absolute-path>)` so Pi renders it as a clickable terminal hyperlink.
