---
name: project-knowledge
description: Keep an engagement's knowledge as Markdown in the repository's context/ folder. Use when the user wants to add client documents (pptx, docx, xlsx, pdf), a meeting transcript (Teams .vtt or .docx, or pasted text) or meeting notes to a project, record or close actions and open questions, or asks what is open. Not for building decks (use implement-powerpoint, with context/ as input).
---

# Project knowledge

Client material, meetings, actions and open questions live as Markdown in `context/` at the repository root, next to code or in a project-only repository, so the agent can work from them directly instead of from pasted chat.

## Layout

```text
context/
  sources/        originals and their Markdown conversions, side by side
    2026-11-05-steerco.pptx
    2026-11-05-steerco.md
    2026-11-06-kickoff.vtt
    2026-11-06-kickoff.md
  meetings/       one note per meeting: 2026-11-06-kickoff.md
  actions.md      every action: A-001, A-002, ...
  questions.md    every open question: Q-001, Q-002, ...
  decks/          decks built from this material, with their copy.json and plan
```

If `context/` is missing, run `<skill>/scripts/init.sh` from the repository root; it creates the folders and the two registers and never overwrites. Then add this pointer to the repository's `AGENTS.md`, creating the file if there is none and asking first if it exists and has no such section:

```markdown
## Project context
Engagement sources, meeting notes, actions and open questions live in `context/`. Use the `project-knowledge` skill to add or update them.
```

## Rules for every workflow

- **Name files `YYYY-MM-DD-<kebab-topic>`.** Use the meeting or document date, else the date received. Pass the original file name as the converter's second argument so the conversion header records it.
- **Nothing in `sources/` is edited by hand.** Originals are evidence; conversions are regenerated from them.
- **Meeting notes are frozen once written.** Later changes to an action or question go in `actions.md` or `questions.md`, never back into an older note.
- **Each action or question is written once, in its register.** A meeting note lists only its ids with a few-word label. Owner, due date, status and answer live in the register row.
- **Ids are stable.** The next id is one above the highest in the file. Never renumber or reuse an id, including dropped ones.
- **Do not invent facts.** An owner, date or decision not stated in the source is left blank or marked `[TBD]`. Say what you could not attribute.
- **Client material is confidential.** Before the first commit of client material, check the repository's remote. If it is public or unknown, stop and ask.
- `<skill>` in the workflows means this skill's directory. Run its scripts by absolute path from the repository root; never `cd` into the skill directory. Do not use `soffice` for conversion: under a sandbox it fails with desktop error dialogs.

## Workflows

Read only the workflow the request needs:

| The user wants to | Read |
| --- | --- |
| Add documents (pptx, docx, xlsx, pdf) to the project | `workflows/ingest.md` |
| Turn a transcript or their own notes into a meeting note, with new actions and questions | `workflows/meeting.md` |
| See what is open, or close, update or drop an action or question | `workflows/review.md` |

A transcript in `.docx` goes through `workflows/meeting.md`, which uses the ingest converter for the conversion step.
