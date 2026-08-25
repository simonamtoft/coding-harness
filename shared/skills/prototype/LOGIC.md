# Logic Prototype

A small interactive driver that lets a reviewer exercise a state model by hand. Use this when the question is about **business logic, state transitions, or data shape** — the kind of thing that looks reasonable on paper but only feels wrong once you push it through real cases.

## When this is the right shape

- "I'm not sure if this state machine handles the edge case where X then Y."
- "Does this data model actually let me represent the case where..."
- "I want to feel out what the API should look like before writing it."
- Anything where a reviewer needs to **trigger actions and watch state change**.

If the question is "what should this look like" — wrong branch. Use [UI.md](UI.md). The HTML form described here is still a logic prototype: its controls exist to drive the model, not to explore visual design.

## Process

### 1. State the question and audience

Before writing code, write down what state model and what question you're prototyping. Name who will drive it:

- **Developers working with the project** → use a lightweight terminal/TUI shell.
- **Non-developers reviewing or sharing without project tooling** → use a self-contained HTML shell that opens directly in a browser.

One paragraph in the prototype's README or a comment at the top of the entry point is enough. A logic prototype that answers the wrong question, or cannot be run by its intended reviewer, is pure waste.

### 2. Pick the language

Use whatever the host project uses. If the project has no obvious runtime (e.g. a docs repo), ask.

Match the project's existing conventions for tooling — don't add a new package manager or runtime just for the prototype.

### 3. Isolate the logic in a portable module

Put the actual logic — the bit that's answering the question — behind a small, pure interface that could be lifted out and dropped into the real codebase later. The TUI or HTML around it is a throwaway presentation shell; the domain logic must not depend on that shell.

The right shape depends on the question:

- **A pure reducer** — `(state, action) => state`. Good when actions are discrete events and state is a single value.
- **A state machine** — explicit states and transitions. Good when "which actions are even legal right now" is part of the question.
- **A small set of pure functions** over a plain data type. Good when there's no implicit current state — just transformations.
- **A class or module with a clear method surface** when the logic genuinely owns ongoing internal state.

Pick whichever shape best fits the question being asked, *not* whichever is easiest to wire to a particular shell. Keep it pure: no I/O, DOM access, terminal code, or `console.log` for control flow. The presentation shell imports or calls it; nothing flows the other direction. If the deliverable is one HTML file, keep the pure domain section separate from the DOM event and rendering section even though they share a file.

This is what makes the prototype useful past its own lifetime. When the question has been answered, the validated reducer, machine, or function set can be lifted into the real module; the presentation shell gets deleted.

### 4. Build the smallest shell that exposes the state

Both surfaces must initialise an in-memory state, offer every action relevant to the question, and show the **full relevant state** on first render and after every action. Do not hide fields merely because they are awkward to present.

#### Developer audience: terminal/TUI

Build a **lightweight TUI**. On every tick, clear the screen (`console.clear()` / `print("\033[2J\033[H")` / equivalent) and re-render the whole frame so the reviewer sees one stable view rather than growing scrollback.

Render two parts in this order:

1. **Current state**, pretty-printed and diff-friendly (one field per line or formatted JSON). Use **bold** for field names or section headers and **dim** for less important context. Native ANSI escapes are enough; do not add a styling dependency unless the project already has one.
2. **Keyboard shortcuts**, listed at the bottom: `[a] add user  [d] delete user  [t] tick clock  [q] quit`.

Read one keystroke or line at a time, dispatch it to the domain logic, and render again. Keep the whole frame on one screen.

#### Non-developer audience: self-contained HTML

Build one HTML file that opens directly in a browser without a package install, build step, local server, or network access. Inline the small amount of CSS and JavaScript it needs; do not load a framework, font, analytics script, or CDN asset.

Render two regions:

1. **Action controls** with plain labels that use the reviewer's domain language.
2. **Current state**, always visible as formatted JSON or an equally complete field-by-field view.

Each control dispatches to the isolated domain logic and immediately re-renders the complete state. Keep visual treatment functional and neutral: this artifact tests behavior, not appearance.

### 5. Make it runnable in one step

For a TUI, add a script to the project's existing task runner (`package.json`, `Makefile`, `justfile`, or `pyproject.toml`). If the host project has no task runner, put the single command at the top of the prototype's README.

For self-contained HTML, the handoff is the `.html` file itself. Verify it works when opened directly from disk in a browser.

### 6. Hand it over

Give the reviewer the one command or HTML file. They'll drive it themselves; the interesting moments are when they say "wait, that shouldn't be possible" or "huh, I assumed X would be different" — those are bugs in the _idea_, which is the whole point. If they want new actions added, add them. Prototypes evolve.

### 7. Capture the answer

When the prototype has done its job, the answer to the question is the only thing worth keeping. If the user is around, ask what it taught them. If not, leave a `NOTES.md` next to the prototype so the answer can be filled in (or filled in by you, if you've watched the session) before the prototype gets deleted.

## Anti-patterns

- **Don't add tests.** A prototype that needs tests is no longer a prototype.
- **Don't wire it to the real database.** Use an in-memory store unless the question is specifically about persistence.
- **Don't generalise.** No "what if we wanted to support X later." The prototype answers one question.
- **Don't blur the logic and presentation together.** If the reducer or state machine references `console.log`, prompts, terminal escapes, or the DOM, it is no longer portable. Keep either shell thin and the domain logic pure.
- **Don't turn a logic prototype into a visual mockup.** The HTML option exists for audience access, not UI polish.
- **Don't ship the presentation shell into production.** The domain logic behind it is the bit worth keeping.
