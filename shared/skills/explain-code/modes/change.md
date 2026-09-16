# Change mode

1. Identify the target and base before interpreting the patch:
   - working tree: distinguish staged and unstaged changes, normally against `HEAD`;
   - commit: use its parent, accounting for merge commits;
   - branch: use the merge base with the repository’s default or user-named base branch;
   - pull request: use its recorded base and head when available.
2. Read the whole change, then inspect the surrounding pre-change and current implementation, callers, contracts, and focused tests needed to understand it.
3. Give only the background required to understand the change. Do not write a generic subsystem tour first.
4. Explain the core intuition with a concrete input, state transition, request, or other small example when that clarifies the design.
5. Walk the change in a coherent conceptual or runtime order: contract and data model, producer, consumer, effects, then tests is one common sequence. Group related edits across files; do not restate hunks in file order. Describe changed ownership or placement factually; do not label it right, wrong, better, or worse unless critique was separately requested.
6. End with the resulting behavior and important unchanged boundaries. This is teaching, not approval: do not imply correctness merely because the change is understandable.

A typical answer is: scope/base, necessary background, core intuition, ordered walkthrough, and resulting behavior. Keep examples faithful to the inspected code and label simplified values as illustrative.
