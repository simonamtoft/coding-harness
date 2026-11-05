---
name: zoom-out
disable-model-invocation: true
description: Local-maximum check — zoom out from the current work and look for a fundamentally better approach, including one that abandons the current approach. Use when the user asks to zoom out, step back, or rethink, or suspects the work is stuck or optimizing a proxy instead of the real goal.
---

# Zoom out

The current approach may be a **local maximum**: the best of its neighbourhood, not the best available. Find out, with the user, where the **global maximum** lies, even if reaching it means abandoning the current approach. The current approach is itself a candidate; if it wins, say so.

This is a read-only checkpoint. Do not edit files or continue the current work until the user picks a direction.

## 1. Map the position

Read the conversation and environment (code, docs, earlier attempts) and write one line each:

- **Goal**: the outcome the user actually wants.
- **Objective**: what the current work optimizes in practice. A gap between Goal and Objective means the work is chasing a **proxy**; that gap is your strongest lead.
- **Approach**: how it is being pursued, and what has already been tried.
- **Constraints**: each tagged _given_ (stated by the user or enforced by the environment) or _assumed_ (inferred, never confirmed).

Done when every line is grounded in something you read, or marked _unknown_.

## 2. Reframe

Generate candidates with these moves:

- **Re-aim**: optimize the Goal directly, bypassing the proxy.
- **Drop an assumption**: take one _assumed_ constraint as false and see what opens up.
- **Greenfield**: knowing what we know now, what would you build from zero, with no sunk cost?
- **Go up a level**: ask why the problem exists, and whether it can be eliminated rather than solved.
- **Invert**: list what would guarantee failure, then check the current approach against it.
- **Borrow**: find how an adjacent field solves a problem of the same shape.

Done when you hold at least three candidates beyond the current approach, at least one of which discards it entirely, and each names its gain and its cost against the current approach.

## 3. Ask

The user holds context you lack, so the ranking needs their input. Prepare up to four questions covering both the **known unknowns** (the _assumed_ and _unknown_ lines from step 1) and the **unknown unknowns** (what the user values, has tried, or would rule out that nothing so far has surfaced). Answer from the repository instead of asking whenever inspection can settle a question.

## 4. Hand off

Write in the response:

1. The position in one or two lines, leading with the Goal/Objective gap if there is one.
2. The candidates, current approach included, ranked by your best guess: one line each for the reframe, its gain, its cost.

Then ask the step 3 questions in one `ask_user_question` call and end the turn there. Make each question answerable on its own, because some clients show only the question and its options. When the user answers, rerank and recommend one direction with its first concrete step.
