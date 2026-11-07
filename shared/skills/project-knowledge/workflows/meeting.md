# Meeting note from a transcript

Turn one meeting into a frozen note and register its actions and questions once.

## 1. Get the transcript into `context/sources/`

| Input | Do |
| --- | --- |
| Teams `.vtt` | Copy it in as `YYYY-MM-DD-<topic>.vtt`, then run `<skill>/scripts/vtt-to-md.sh <that file> "<original name>"`. The result has one paragraph per speaker turn with its start time. |
| Teams or Word `.docx` | Copy it in, then run `<skill>/scripts/convert.sh <that file> "<original name>"`. |
| Pasted text or the user's own notes | Save it unchanged as `YYYY-MM-DD-<topic>-transcript.md`. |

Read the Markdown version in full before writing anything.

## 2. Read the registers

Read `context/actions.md` and `context/questions.md`. You need the next free ids and the open items, because the meeting may progress or close them.

## 3. Write `context/meetings/YYYY-MM-DD-<topic>.md`

```markdown
# <Meeting title>

- Date: YYYY-MM-DD
- Participants: <names as they appear in the transcript>
- Source: [transcript](../sources/YYYY-MM-DD-<topic>.md)

## Summary
<3 to 6 sentences: what the meeting was for and where it landed>

## Decisions
- <decision, with who made it if stated>

## Actions
- New: A-014 vendor shortlist, A-015 data owner
- Updated: A-009 done, A-011 due moved

## Questions
- New: Q-006 budget after go-live
- Answered: Q-002

## Discussion
<by topic, short paragraphs; attribute claims to speakers where it matters>
```

Leave out sections that would be empty. Keep the note to what was said: an inference is labelled as one.

## 4. Update the registers in the same change

- Append each new action and question as a row under **Open**, with the next id and `Raised in` linking to the meeting note.
- An existing item the meeting finished or answered moves to **Closed** with its outcome or answer and `Closed in` linking to this note. A changed owner or due date is edited in its row, with the date of the change in Notes.
- Check that every id the note lists exists in a register, and that every row you added links back to this note.

## 5. Report

Give the note's path, the new and changed ids, and anything you could not attribute: an action without an owner, a date that was implied but not said.
