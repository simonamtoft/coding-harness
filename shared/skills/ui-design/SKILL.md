---
name: ui-design
description: Design and build or review web interfaces and pages with deliberate, non-generic craft. Covers design planning, layout and typography, polish details, motion, accessibility floor and UI copy, for HTML/CSS and any framework. Use when creating or critiquing a page, component or screen and no brand system dictates the look. Not for verifying a render (use visual-verification).
---

# UI design

Stack-neutral craft rules for interfaces. Where the project or a brand skill
fixes tokens, components or voice, those win; this skill fills the gaps and
supplies the quality floor. A deliberate, consistent project convention is not
a defect. The same detail done two ways in one project is.

## 1. Plan before markup

Skip this section for a small edit to an existing interface.

1. State the purpose, the audience and the one action the interface supports.
2. Write a compact plan: 4–6 named colours, the typefaces and their roles, a
   layout concept (one sentence, or an ASCII wireframe, with alignment stated),
   and the one thing that should be memorable.
3. Review the plan against the brief. If a part is what you would produce for
   any similar page, change it and say what you changed. The brief's own words
   always win over these rules.

Defaults to treat as choices, not reflexes: a cream background with a serif
and terracotta accent; near-black with one acid accent; identical rounded
cards with the same soft shadow; gradient washes as decoration; tracked
ALL-CAPS eyebrows above every heading; `→` on every link; a monospace face for
small labels.

Spend boldness in one place. Keep the rest quiet. Cut decoration that does not
serve the brief.

## 2. Layout and type

- One spacing scale and one radius scale. Use them for everything.
- Group by proximity: space inside a group is clearly smaller than space
  between groups.
- Make hierarchy with size, weight and space before colour. Limit the accent to
  one colour per view.
- Nested rounded surfaces with an even inset: outer radius = inner radius +
  padding. Past about 24px of padding, treat the layers as separate surfaces.
- Balance headings (`text-wrap: balance`), keep body copy free of orphans
  (`text-wrap: pretty`), cap line length near 65–75 characters, and use
  tabular figures (`font-variant-numeric: tabular-nums`) for numbers that align
  or update.
- Reserve space for images and embeds (`aspect-ratio`, explicit dimensions) so
  content does not jump on load.
- Use `100dvh`, not `100vh`, for full-height layouts. Respect safe-area insets
  for fixed elements.
- Use a fixed z-index scale, not ad-hoc values.
- Shadows signal elevation, borders signal structure. Do not use a border only
  to fake depth. Keep a transparent border under a shadow ring so forced-colors
  mode still draws an edge.
- Give content images a 1px inset outline in pure black or white at about 10%
  opacity, never a tinted colour. Skip it for logos and illustrations.
- Optical alignment beats geometry: nudge icons, play triangles and
  icon-bearing buttons by eye.

## 3. Motion

- Add motion only where it carries information: state change, spatial
  continuity, or one deliberate moment. High-frequency actions (keystrokes,
  hovers, tab switches) respond instantly or within 150ms.
- Animate `transform` and `opacity`. Do not animate layout properties, and
  avoid large `blur()` or `backdrop-filter` surfaces.
- Interactive state uses CSS transitions, which reverse mid-flight. Keyframes
  are for one-off sequences.
- Enters use `ease-out`, about 300ms. Exits are shorter and smaller, about
  150ms. Stagger a staged entrance by about 100ms per semantic chunk, and never
  stagger routine interactions.
- A pressed button may scale to about 0.96 over 150ms. A disabled one does not.
- Gate movement behind `prefers-reduced-motion: no-preference`. Under reduced
  motion, cross-fade. Every animated change also has a static cue (colour, icon
  or label).
- Pause looping animation that is off-screen. Apply `will-change` only during
  an active animation.

## 4. Accessibility floor

- Visible keyboard focus on every interactive element. Never remove an outline
  without a replacement.
- Touch targets at least 44×44px.
- Text contrast at least 4.5:1 (3:1 for large text and for input boundaries).
  Colour is never the only carrier of meaning.
- Use native elements and established primitives for anything with keyboard or
  focus behaviour. Do not rebuild them by hand.
- Every form field has a visible label. Icon-only buttons have an accessible
  name. Errors appear next to the field or action that caused them.
- Semantic landmarks and one `h1`, with headings in order.
- Never block paste. Confirm destructive or irreversible actions.
- Works down to a narrow mobile width with no horizontal scroll.

## 5. UI copy

- Write for the user's task in plain words, not the system's structure.
- Active voice, sentence case, no filler. A button names what happens ("Save
  changes", not "Submit") and keeps that name through the flow ("Published" in
  the toast).
- Errors say what went wrong and how to fix it, without apologising. Empty
  states give one clear next action.
- One job per written element. Use specific, legible words over clever ones.

## 6. Check

- Critique as you build. When the page can be rendered, use the
  `visual-verification` skill to screenshot desktop and mobile widths, and judge
  against sections 1–5.
- Resist the checklist where it conflicts with the brief or a brand system.
  Report the conflict instead of silently breaking either.
- When reviewing existing UI, list verified defects only: quote the element,
  say why it matters in one sentence, give a concrete fix. Do not edit unless
  asked.
