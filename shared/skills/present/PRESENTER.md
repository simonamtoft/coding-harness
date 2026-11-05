# Present completed work as a before/after report

You turn a delivery brief into one static HTML page that shows what changed, mostly as visuals. You write a JSON spec; `scripts/build-report.mjs` owns all HTML, styling, diffs, and diagram rendering. Never hand-write report HTML or CSS.

Run every script by its absolute path under the skill directory, from the active repository. Never `cd` into the skill directory.

## 1. Choose what to show

List the few changes a reader must see to trust the outcome, usually two to six. Each becomes one numbered change, showing before and after side by side. Pick the kind that shows the change most directly:

| Kind | Use for | Source of truth |
| --- | --- | --- |
| `diff` | Code or configuration whose exact lines matter | Git, via spec `ref` (a commit) or `base` (working tree against a revision). Pick the hunks that matter with `hunks: [n, …]` |
| `image` | Anything user-visible: pages, components, rendered output | Screenshots you or the parent captured |
| `terminal` | CLI output, error messages, logs | Exact command output, trimmed to the lines that changed |
| `steps` | Procedures, checklists, instruction or method changes | The source documents; mark added items `{ "text": …, "new": true }` |
| `diagram` | Call order (`sequenceDiagram`), workflows, architecture, dependencies, ticket maps (`flowchart`) | Code paths and docs you read; Mermaid source in `before` and `after` |

Omit `before` when something is new or when the report is not a comparison (an investigation finding, a plan); that change then renders as a single panel. In flowcharts, tag nodes `:::added` (green) or `:::removed` (red, dashed). In sequence diagrams, wrap new steps in `rect rgb(236,253,243) … end`. Keep both sides of a diagram in the same layout direction and node names so the difference is easy to spot.

For multiple tickets with dependencies, follow [references/backlog-dependency-map.md](references/backlog-dependency-map.md).

Every visual must be faithful to its source. Do not invent UI, output, or behaviour. If you cannot get a trustworthy capture, leave the change out and add a caveat instead.

## 2. Capture screenshots for user-visible work

- **After:** capture the running app with the `visual-verification` skill's `capture-pages.mjs` or `capture-scenario.mjs` at `deviceScaleFactor` 1, written under the session temporary directory.
- **Before:** use captures the brief supplies. Otherwise, if the app is cheap to serve, export the base revision with `git archive <base> | tar -x -C "$PI_SESSION_TMPDIR/agent-final-<report-id>-base"`, start it on a free port, and capture the same routes and viewport. If that is impractical, omit `before` and add the caveat `No before capture`.
- Crop to the region that changed when the page is long. Prefer JPEG for photographic content; the build warns above 1.5 MB per image.

## 3. Write the spec

Copy the shape of [assets/report-spec.example.json](assets/report-spec.example.json). Generate one collision-resistant report ID and write the spec and report as `${PI_SESSION_TMPDIR:-${TMPDIR:-/tmp}}/agent-final-<report-id>.json` and `.html`.

Text is minimal by design and the build enforces it:

| Field | Limit | Content |
| --- | --- | --- |
| `title` | 70 chars | The outcome, as a statement |
| `summary` | 160 chars, optional | One sentence that adds to the title; omit if it would repeat it |
| `changes[].title` | 60 chars | What this change is |
| `changes[].note` | 140 chars, optional | One tiny explainer: why it matters or what to look at. Omit when the visual speaks for itself |
| `checks[].name`, `caveats[]` | 40 chars each | Checks run, with `pass`, `fail`, or `skip`; limitations and unverified behaviour |
| `meta` | free | Commit, ticket ID and status, file count |

Name checks; do not count test cases. Do not add text that restates the title, describes the report, or records that nothing happened. When the build rejects text as too long, cut words; do not split it across fields.

## 4. Build and check

```bash
node <skill-dir>/scripts/build-report.mjs <spec.json>
node <skill-dir>/scripts/validate-report.mjs <report.html>
node <skill-dir>/scripts/render-report.mjs <report.html> "$PI_SESSION_TMPDIR/agent-final-<report-id>-captures"
```

The build reads images only from the session temporary directory or the repository, writes only inside the session temporary directory, and fails on unknown kinds, over-long text, missing hunks, and Mermaid syntax errors. Fix the spec and rebuild.

The render check captures the report at desktop and mobile widths and reports overflow or clipping. Read both captures. Check that before and after are distinguishable at a glance, diagram text is legible, and nothing is clipped. Compare every visual with its source and remove anything unfaithful. If Playwright is missing, the scripts say so; add the caveat `Report not visually checked` rather than installing anything.

## 5. Deliver

Return only:

```markdown
[Open final report](file://<absolute-path>)
```
