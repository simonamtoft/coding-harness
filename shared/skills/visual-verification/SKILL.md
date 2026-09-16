---
name: visual-verification
description: Use after changing how a served web page renders in a browser — colours, spacing, layout, components, responsive behaviour — to confirm the rendered result with browser screenshots instead of asserting it from the diff. Covers capturing pages with Playwright and reading the images back. Not for terminal, CLI, or TUI output.
---

# Visual verification

A CSS or component diff is not evidence. The evidence is the rendered pixels. After a visual change, capture the affected pages and **look at the images** before reporting the work as done.

This skill owns the capture-and-inspect mechanics. It does not own per-turn test/lint/typecheck commands — that is `wire-up-verifier`.

## The loop

1. **Start the app** with the project's documented dev command, on the project's documented port. If the project has a Playwright config, prefer its `webServer` block: it owns startup, readiness, and teardown, and it fails loudly when the port is already taken rather than testing someone else's app.
2. **Capture** the affected routes at the widths that matter.
3. **Read every image back** with the Read tool. A capture nobody looked at proves nothing.
4. **Fix and re-capture** until the rendering matches intent.
5. **Stop only the servers you started.** Leave a pre-existing dev server alone.

## Capturing

For plain route captures, use the bundled script from the repository root:

```bash
node <skill-dir>/scripts/capture-pages.mjs \
  --base http://localhost:<port> \
  --out "${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/visual" \
  --routes .,about,contact \
  --viewport 1280x900,390x844 \
  --wait '<readiness-selector>' \
  --prefix before
```

It resolves Playwright from the active repository, launches managed Chromium, waits for load, network idle, the optional readiness selector, and web fonts, then prints each written path. Add `--full-page` for long pages. Exit codes: `2` Playwright or Chromium missing, `3` page unreachable, `4` readiness selector never appeared.

`--base` must be an `http`/`https` URL: this captures a served application, not local files. Write routes **relative to `--base`**, without a leading slash (`.`, `about`, `writing/first-post`). A leading slash makes the argument look like an absolute filesystem path to the agent's command guard, which will refuse the command.

When a capture needs interaction — opening a modal, hovering, keyboard navigation, scrolling a lazy element into view — write a project-specific scenario module and run it through the bundled lifecycle helper:

```bash
node <skill-dir>/scripts/capture-scenario.mjs \
  --base http://localhost:<port> \
  --out "${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/visual" \
  --scenario scripts/capture-deck.mjs
```

The scenario default-exports an async function. It receives the active Playwright `page`, the supplied `baseURL`, and `capture(name, options)`. Navigate and interact with ordinary Playwright calls; call `capture` only when the state is ready. The runner resolves Playwright from the active repository, launches managed Chromium, manages browser teardown, and writes `manifest.json` with the captures it produced.

```js
export default async function captureDeck({ page, baseURL, capture }) {
  await page.goto(new URL("slides/intro", baseURL).href);
  await page.waitForSelector("[data-ready]", { state: "visible" });
  await capture("intro-live");

  await page.getByRole("button", { name: "Print" }).click();
  await page.waitForSelector(".print-ready");
  await capture("intro-print", {
    viewport: "390x844",
    media: "print",
    reducedMotion: "reduce",
    fullPage: true,
  });
}
```

Capture names are filename-safe identifiers and must be unique within a run. `capture` accepts `viewport`, `media` (`screen` or `print`), `reducedMotion` (`no-preference` or `reduce`), and `fullPage`; omitted values retain the runner's initial options. Pass those initial values with `--viewport`, `--media`, and `--reduced-motion` when they apply to every capture.

Non-negotiable rules:

- **Write the scenario to a file and run it.** Never build capture code as an inline `node -e` string. Quoting rules turn concatenated paths into a debugging exercise, and a file can be re-run and diffed.
- **Keep selectors and workflow in the project.** The shared runner owns only browser lifecycle and output; it must not acquire project routes, labels, or readiness rules.
- **Write captures into the session workspace**, `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}`, never into the repository and never into a shared temp root that the agent may not read back.
- **Wait for a state signal, not a duration.** Wait for the class, attribute, or selector that marks readiness (`.is-visible`, `[data-ready]`, a settled animation). Fixed `waitForTimeout` sleeps produce captures of half-rendered pages and flaky reruns.

## Reading the captures

Read each PNG and check it deliberately: intended change actually applied, hierarchy and legibility, contrast, wrapping and clipping, first-viewport content, and whether the narrow viewport degrades sensibly. Report what you saw. If browser tooling was unavailable, say so rather than implying visual confirmation.

## What belongs in project instructions

Keep this skill harness-level. Ports, routes, readiness selectors, the dev command, and per-project quirks belong in the project's own `AGENTS.md`/`CLAUDE.md` or its verification skill — not here.
