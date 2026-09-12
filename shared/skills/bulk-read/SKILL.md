---
name: bulk-read
description: Use when a read-routing hook redirects an oversized read, or when extracting specific facts from multiple large reference files without loading them into the parent context. Not a substitute for direct source inspection during debugging, architecture, editing, or safety-critical reasoning.
---

# Bulk read

Keep bulk evidence in a cheap read-only worker; retain the question, decisions, and exact source needed for reasoning in the parent.

1. **Choose extraction or direct inspection.** Delegate predictable lookup, inventory, or summarization. For debugging, architecture, editing, safety-critical reasoning, or instructions that must be read completely, inspect original source directly using explicit `offset` and `limit` values of at most 350 lines, continuing as needed. Never summarize governing instructions on the parent's behalf. Do not evade routing with shell reads or oversized limits.
2. **Frame one bounded assignment.** Supply a specific question, explicit absolute file paths, and the active working directory. Group related files into one assignment instead of one worker per file. Pass paths, not pasted contents or conversation history. Do not read the files first merely to brief the worker. Use only paths the worker may access under its own permissions; do not copy protected data or change working directories to defeat a read denial. Respect project data/provider restrictions. Pi honors `bulk-reader`'s configured provider/model pin independently of the parent; this is predictable routing, not a same-provider data-egress boundary. Claude uses its separately pinned provider, so use bounded direct reads when that provider is not permitted for the files. A read-only worker still sends file contents to its model provider.
3. **Dispatch one `bulk-reader`.** The worker follows `BULK-READER.md` in this skill directory.
   - **Pi:** use `subagent` with `agent: bulk-reader`, `agentScope: user`, `cwd` set to the active working directory, and the assignment in `task`.
   - **Claude Code:** use the native `Agent` tool (`Task` in older versions), with `subagent_type: bulk-reader` and the assignment in `prompt`. Use the model pinned by the agent definition.
4. **Use the result as a map, not proof of correctness.** Retain findings, source locations, coverage gaps, and uncertainties. Verify exact source before edits or consequential conclusions. Read only the needed sections unless complete inspection is required. If the worker fails, cannot access a path, or returns inadequate evidence, report the limitation and use permitted bounded direct reads; do not repeatedly redispatch the same failed assignment or switch to a more expensive worker silently.

Done means the specific question is answered with source-backed findings, or the missing evidence is explicit. No writes, commands, nested delegation, generic repository exploration, or automatic code generation belong to this workflow.
