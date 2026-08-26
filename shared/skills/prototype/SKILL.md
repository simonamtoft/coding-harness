---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like (e.g. show a preliminary page before implementing it).
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a small interactive driver for the state model. Use a terminal/TUI for developer-led exploration; use a self-contained HTML demo when non-developers need to drive it without project tooling.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **One step to run.** Use one command through the project's existing task runner, or make a self-contained HTML artifact that opens directly in a browser. The reviewer must be able to start it without setup.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast and then delete it.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Delete or absorb when done.** When the prototype has answered its question, either delete it or fold the validated decision into the real code. Preserve the artifact only when the task explicitly names durable review or reproducibility as evidence it needs. Keep any preserved prototype on a clearly temporary branch, never the main branch, and remove it when that evidence is no longer needed.

## When done

The _answer_ is the only thing worth keeping from a prototype. Capture it somewhere durable along with the question it was answering. If the user is around, that capture is a quick conversation; if not, leave the placeholder so they (or you, on the next pass) can fill in the verdict before deleting the prototype.

If this prototype resolves a `/wayfinder` prototype task or another Backlog task, record the verdict there through the CLI. Read `backlog instructions task-execution` before adding progress notes and `backlog instructions task-finalization` before completing the task. Reference a preserved artifact with `--add-ref`; never edit the task Markdown directly.

```bash
backlog task edit <id> --append-notes "Prototype verdict: <which option won and why>" --plain
backlog task edit <id> --add-ref <durable-artifact-path-or-url> --plain
```

Omit the reference when the prototype is deleted rather than preserved. Otherwise capture the answer in a commit message, an ADR (`/domain-modeling`), or a `NOTES.md` next to the prototype.
