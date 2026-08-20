---
name: wayfinder
disable-model-invocation: true
description: Plan a huge chunk of work — more than one agent session can hold — as a shared map of investigation tickets on the FP tracker, and resolve them one at a time until the way to the destination is clear. Use for large, foggy, multi-session efforts.
---

# Wayfinder

A loose idea has arrived — too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the FP tracker, then works its tickets one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting — it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic — engineering work, course content, whatever fits the shape.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear — nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes** — carrying execution into the map itself — but absent that, produce decisions, not deliverables.

When the map's decisions are settled and you're ready to turn them into a concrete implementation plan, that's the handoff to `/to-spec` (crystallize the decisions into a spec issue) and then `/to-tickets` (slice the spec into implementation tickets).

## Refer by name

Every map and ticket is an FP issue, so it has a **name** — its title. In everything the human reads — narration, the map's Decisions-so-far — refer to it by that name, never by a bare id, number, or slug. A wall of `WFTE-abcd, WFTE-efgh` is illegible; names read at a glance. The id and URL don't vanish — a name wraps them — but they ride *inside* the name, never stand in for it. Write links as `[<ticket title>](WFTE-abcd)`.

## FP operations

Everything lives on the FP tracker (`fp`). This repo's issue prefix is whatever `fp init` assigned (e.g. `IMPR-`, `WFTE-`); the examples below use `<id>` placeholders.

| Concept | FP command |
|---|---|
| Create the map (root issue) | `fp issue create --title "<map title>" --property labels=wayfinder:map --body <map-body-file>` |
| Create a ticket (child of map) | `fp issue create --title "<ticket title>" --parent <mapId> --property labels=wayfinder:<type> --body <ticket-body-file>` |
| Wire blocking edges (2nd pass) | `fp issue update <id> --depends <blockerId1>,<blockerId2>` |
| Claim a ticket | `fp issue update <id> --status in-progress` |
| List map children (for frontier) | `fp issue list --parent <mapId> --format json` |
| Read a ticket in full | `fp context <id>` |
| Record resolution | `fp comment add <id> --file resolution.md` then `fp issue update <id> --status done` |
| Update the map body | re-read the current body via `fp context <mapId>` *immediately* before writing, append the new line, then re-send the whole body as a literal arg: `fp issue update <mapId> --body "<full new body text>"` |

**Statuses** are `todo` (default for new issues — the "open"/unstarted state), `in-progress` (claimed / being worked), and `done` (resolved). **Never `open`** — FP has no such status.

**Body handling differs between create and update** (verified against this `fp` version — don't guess):
- **`fp issue create --body <file>`** reads the file's contents. This is the simplest form: write the body to a file, pass its path. (`--body=-` reads stdin via a pipe; a bare `--body -` with a space is rejected by the arg parser. `<` redirect and `$(...)` both misbehave with `fp`.)
- **`fp issue update --body "<text>"` is literal-only** — it does *not* read files or stdin, so a path or `-` would be stored verbatim. To rewrite the map body, pass the entire new body as one literal quoted argument. A single `fp …` command (even with a multi-line quoted arg) is pre-approved by the hook.

Heredocs and shell variable assignments are blocked by the bash hook, so write body files with your editor/Write tool rather than `cat <<EOF`.

**`--depends` replaces the whole dependency set** on each update — it does not append. Pass the complete comma-separated list every time.

### Labels can't be read back — mirror the type in the body

FP accepts label values (including the colon form `wayfinder:map`, `wayfinder:research`, …) and shows them in the desktop app, but **no CLI read command surfaces them** (`list`, `tree`, `context`, and all `--format json` output omit labels). So the label is for the human's desktop view only. So the driving agent can know a ticket's type, **also record it in the ticket body** — the `**Type:**` line in the template below. Read type from the body via `fp context <id>`, never from the label.

Labels ride on FP's `labels` extension, which is loaded by default. FP **errors** on an unregistered property, so if `fp guide` doesn't list a registered `labels` property (a project can disable the extension), **omit every `--property labels=` flag** — the label is a pure desktop nicety and the body `**Type:**` line is the source of truth, so nothing downstream breaks. Glance at `fp guide` once when you start charting; don't check per ticket.

## The Map

The map is a single FP issue labelled `wayfinder:map` — the canonical artifact. Its tickets are child issues of the map (`--parent <mapId>`).

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place — its ticket — so the map never restates it, only gists it and links.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed — they are the map's `todo` child issues, found by query.

```markdown
## Destination

<what reaching the end of this map looks like — the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort. If this effort carries execution into the map (overriding "plan, don't do"), say so here.>

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then open the link for the detail the ticket holds -->

- [<closed ticket title>](<id>) — <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a **child issue** of the map; FP's issue id is its identity. Its body is the question, sized to one ~100K token agent session:

```markdown
## Question

<the decision or investigation this ticket resolves>

**Type:** research | prototype | grilling | task
```

Each ticket also carries a `wayfinder:<type>` label for the desktop view (`--property labels=wayfinder:<type>`), but the `**Type:**` line in the body is the source of truth the agent reads.

A session **claims** a ticket by setting its status to `in-progress` **first**, before any work, so concurrent sessions skip it. An unclaimed ticket is one still in `todo`.

Blocking uses FP's native `--depends`. A ticket is **unblocked** when every ticket it depends on is `done`; the **frontier** is the `todo`, unblocked children — the edge of the known. Compute it from `fp issue list --parent <mapId> --format json`: take issues with `status: "todo"` whose every entry in `dependencies` resolves to a `done` issue.

The answer isn't part of the body — it's recorded on resolution (see [Work through the map](#work-through-the-map)). Assets created while resolving a ticket are attached with `fp attach <file>` and linked from the ticket, not pasted into the body.

## Ticket Types

Every ticket is either **HITL** — human in the loop, worked *with* a human who speaks for themselves — or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it (a grilling agent that answers its own questions has broken this).

- **research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases. Creates a markdown summary attached via `fp attach`. Use when knowledge outside the current working directory is required.
- **prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to — an outline, a rough take, a stub, or UI/logic code via `/prototype`. Attaches the prototype (or a note pointing at it) as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **grilling** (HITL): Conversation via `/grill` (and `/domain-modeling` when terminology needs pinning down), one question at a time. The default case.
- **task** (HITL or AFK): Manual work that must happen before a *decision* can be made — nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that *does* rather than decides — and it earns its place by unblocking a decision, not by delivering the destination. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). Resolved when the work is done; the answer records what was done and any resulting facts (credentials location, new URLs, row counts) later tickets depend on.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war** — the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets — one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination — everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now — _not_ whether you can answer it now.

- **Ticket when** the question is already sharp — even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope** — it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates — the frontier stops at the destination — so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination — mis-scoped in while charting, or exposed by a resolution — **close it** (`fp issue update <id> --status done` with a comment noting it's out of scope) and leave one line in the **Out of scope** section: the gist plus why it's out of scope, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked — a scope boundary isn't a step on it.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session.**

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Run a `/grill` session (and `/domain-modeling` if terminology needs pinning down) to nail what this map is finding its way to — the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** — the way to the destination is already clear, the whole journey small enough for one session — you don't need a map. Stop and ask the user how they'd like to proceed (likely straight to `/to-spec` or `/to-tickets`).
3. **Create the map** (`--property labels=wayfinder:map`): Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**.
4. **Create the tickets you can specify now** as child issues of the map (`--parent <mapId>`, each with its `**Type:**` and `wayfinder:<type>` label) — then wire blocking edges in a **second pass** with `--depends` (issues need ids before they can reference each other). Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog — the **Not yet specified** section.
5. Stop — charting the map is one session's work; do not also resolve tickets.

### Work through the map

User invokes with a map (id or URL). A ticket is **optional** — without one, you pick the next decision, not the user.

1. Load the **map** body (`fp context <mapId>`) — the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it. Otherwise compute the frontier (`fp issue list --parent <mapId> --format json`; `todo` issues whose dependencies are all `done`) and take the first in order. **Claim it**: `fp issue update <id> --status in-progress` before any work.
3. Read the ticket's `**Type:**` from `fp context <id>` and resolve it — **zoom as needed**: fetch the full body of any related or closed ticket on demand; invoke the skills the ticket's type and the map's `## Notes` name (`/grill`, `/domain-modeling`, `/prototype`). If in doubt, use `/grill`.
4. Record the resolution: `fp comment add <id> --file resolution.md` with the answer, `fp issue update <id> --status done`, then append a one-line context pointer to the map's Decisions-so-far. The map body is the one shared mutable document and other sessions may have edited it since you loaded it at step 1, so **re-read it immediately before writing** (`fp context <mapId>`), append your line to that fresh copy, and only then re-send the whole body as a literal arg (`fp issue update <mapId> --body "<full new body text>"`). If the re-read differs from what you loaded at step 1, merge onto the newer version — never overwrite it with your stale copy.
5. Add newly-surfaced tickets (create-then-wire); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals a ticket — this one or another — sits beyond the destination, **rule it out of scope** rather than resolving it on the route. If the decision invalidates other parts of the map, update or delete those tickets.

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.
