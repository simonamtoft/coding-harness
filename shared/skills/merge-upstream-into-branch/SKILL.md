---
name: merge-upstream-into-branch
description: Use when the user wants to merge main/master into a feature branch, pull recent upstream changes into their working branch, resolve merge conflicts after such a merge, or sync a branch with upstream. Enforces direction, scope, and rename-handling rules that prevent the common "agent edits files the branch didn't touch" failure mode.
---

# Merge upstream into a feature branch

Bring the latest upstream changes into a feature branch and resolve conflicts cleanly, without expanding the branch's scope.

## When this triggers

- "Pull main into my branch"
- "Merge master into our branch"
- "Help with these merge conflicts" (after the user already started a merge)
- "Sync with upstream"
- "We've drifted from main, catch us up"

## Procedure

1. **Confirm direction explicitly.** Restate it back: "Merging `<upstream>` into `<feature-branch>`, not the other way." Wait for confirmation if there's any ambiguity. The wrong direction destroys work.
2. **Snapshot pre-merge state.** Record the current build/test status so you can tell *new* breakage apart from pre-existing breakage after the merge.
3. **Start the merge** (`git merge <upstream>` or `git pull origin <upstream>`).
4. **List conflicts** with `git status` and group them by directory.
5. **Resolve each conflict** using the rules below.
6. **Verify** by running the project's build/test and comparing failure set vs. the pre-merge snapshot. Only *new* failures need fixing; pre-existing ones are out of scope.

## Rules

- **Direction:** upstream → feature, never the reverse. If the user says "merge our branch into main", stop and confirm — they almost certainly mean the other way.
- **Rename rule:** if upstream renamed or moved a file, adopt upstream's new name. Don't recreate the old name. Don't keep both.
- **Scope rule:** only modify files the feature branch already touched (compare with `git diff --name-only <merge-base> <feature-branch>`). If conflicts appear in files the branch didn't touch, that's drift — surface it, don't silently "fix" it. Editing untouched files is the #1 cause of merge sprawl.
- **No build-fixing detours.** If the build fails on a file the feature branch doesn't own, surface the failure and ask before fixing — the breakage may belong upstream.

## Verification recipe

After the merge:
- Re-run the same build/test command from the pre-merge snapshot.
- Diff the failure sets: `<new failures> = <post> - <pre>`.
- Only new failures are in scope for this merge.

## Done means

- Working tree clean, conflicts resolved.
- Build/test passes with no *new* failures compared to pre-merge.
- Feature branch's diff vs. upstream is the original feature work plus rename/import adjustments — nothing else.
