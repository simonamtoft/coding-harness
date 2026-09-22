---
name: to-tickets
disable-model-invocation: true
description: Break a plan, specification, or the current conversation into tracer-bullet Backlog.md tasks with explicit blocking dependencies.
---

# To Tickets

Break a plan, specification, or conversation into **tasks**: tracer-bullet vertical slices with explicit blockers, published through Backlog.md.

## Process

### 1. Gather context

Use what is already in the conversation. If the user supplies a Backlog task ID, read it with `backlog task view <id> --plain`. If they supply a plan or specification path, read it completely.

### 2. Explore the codebase when needed

Understand the current implementation before slicing work. Use the project's domain vocabulary (see `/domain-modeling` and any `CONTEXT.md`) and respect relevant ADRs.

Look for prefactoring that genuinely makes the requested change easier: make the change easy, then make the easy change.

### 3. Draft vertical slices

Each slice should:

- cut a narrow but complete path through the layers it needs
- be independently demonstrable or verifiable
- fit in one fresh context window
- name only blockers that genuinely prevent it from starting

A task with no blockers can start immediately.

**Wide refactors are the exception.** Before choosing a migration shape, inventory every caller and compatibility surface: public APIs, external or multi-repository consumers, independently deployed services, staged rollouts, and persisted schema or data.

When every consumer is controlled, internal, changeable, and verifiable together, one same-wave task may migrate every caller and delete the legacy path after verification. Otherwise use expand–contract:

1. Add the new form beside the old, with the required compatibility plan.
2. Migrate callers in independently green batches sized by package or directory.
3. Remove the old form and temporary compatibility code after all migration and final integration verification make deletion safe.

Give every phase its own verification boundary. If migration batches cannot stay green independently, use a shared integration branch only with explicit approval and add a final integrate-and-verify task blocked by every batch.

### 4. Get approval

Present the proposed breakdown as a numbered list. For each task show:

- **Title**
- **Blocked by**
- **What it delivers**

Ask whether the granularity and blocking edges are right and whether any tasks should be merged or split. Iterate until the user approves.

### 5. Publish through Backlog.md

Run `backlog instructions task-creation` before creating tasks. Create blockers before their dependents so later tasks can reference real IDs.

For each task, use structured Backlog fields rather than editing task Markdown:

```bash
backlog task create "<task title>" \
  --description "<what the task delivers>" \
  --ac "<acceptance criterion>" \
  --depends-on <blockerId1>,<blockerId2> \
  --plain
```

- Repeat `--ac` for each acceptance criterion.
- Omit `--depends-on` when there are no blockers.
- If the source is an existing Backlog task, add `--parent <sourceId>` to every implementation task.
- Create tasks in dependency order. `--depends-on` sets the complete dependency set supplied at creation.
- Do not close or otherwise modify the source task.
- Do not add labels unless the project already defines a relevant label convention.

<task-content>

**Description:** State the end-to-end behavior this task makes work from the user's perspective, not a layer-by-layer implementation plan.

**Acceptance criteria:** Use observable, independently checkable outcomes.

Avoid file paths and code snippets because they go stale. A prototype snippet may be included only when it captures a decision more precisely than prose; keep only the decision-rich portion and identify it as prototype evidence.

</task-content>

After publication, use `backlog task list --parent <sourceId> --status "To Do" --ready --sort priority --plain` to view the source task's unblocked frontier when a parent exists. Execute one task at a time under the Backlog task-execution workflow.
