---
name: shortcut-ledger
disable-model-invocation: true
description: Use when the user wants the deferred-simplification ledger — "what shortcuts did we leave", "list the shortcut markers", "show the tech-debt ledger", or a review of intentional simplifications and their upgrade triggers. Reads `shortcut:` comments left per CLAUDE.md §2. Read-only — compiles a ledger, never edits code.
---

# Shortcut ledger

Compile every deliberate simplification marked with a `shortcut:` comment into one ledger, and flag the ones that have no upgrade trigger — those are the ones that quietly become permanent.

A `shortcut:` marker (CLAUDE.md §2) names a bounded simplification: `// shortcut: <ceiling>, <upgrade trigger>`. The ceiling is the limit of the shortcut; the trigger is the condition that should prompt revisiting it.

## When this triggers

- "What shortcuts did we leave / list the `shortcut:` markers"
- "Show the tech-debt ledger" / "deferred-simplification review"
- Before a release or handoff, to surface bounded shortcuts that may have outgrown their ceiling

## Procedure (in this order)

1. **Find the markers.** `grep -rnE '(#|//) ?shortcut:' .` excluding `node_modules`, `.git`, and build/output dirs (`dist`, `build`, `target`, `out`, etc.).
2. **One row per marker, grouped by file:**
   `<file>:<line> — <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.`
   When a marker names no trigger, write `upgrade: none — rot risk.`
3. **Summary line:** `<N> markers, <M> with no trigger.`
4. **Clean case:** if no markers exist, output exactly `No shortcut: debt. Clean ledger.` and stop.

## Rules

- **Read-only.** Compile and report; never edit code or remove markers unless the user explicitly asks.
- **Quote, don't invent.** Take the ceiling and trigger from the comment text. If a marker is malformed (no ceiling or trigger parseable), list it as-is and note it's malformed — don't guess intent.
- **No editorializing.** This is a ledger, not a review. Don't argue whether each shortcut was justified unless asked.

## Done means

- A per-file ledger of every `shortcut:` marker, or the clean-ledger line.
- A count of total markers and how many lack an upgrade trigger.
