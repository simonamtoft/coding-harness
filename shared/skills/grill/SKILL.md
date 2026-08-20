---
name: grill
disable-model-invocation: true
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

# Grill

Interview the user relentlessly about every aspect of their plan until a shared understanding is reached. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

## When this triggers

- "Grill me on this"
- "Stress-test my plan"
- "Challenge my design"
- "I want to be grilled about X"
- User pastes a plan and asks for scrutiny

## Procedure

1. **Read the plan.** If the user has attached a file or pasted content, read it fully. If they've only described a topic, ask them to share the full plan or proposal before proceeding.
2. **Map the decision tree.** Internally identify all major decisions, assumptions, dependencies, and open questions in the plan. Group them into branches (e.g. data model, API design, deployment, error handling). Don't share this map with the user — use it to drive the interview.
3. **Interview one question at a time.** Pick the highest-dependency unresolved question and ask it. For each question:
   - Provide your recommended answer and brief reasoning.
   - Wait for the user's response before moving on.
   - If a question can be answered by exploring the codebase, do so instead of asking.
4. **Track what's resolved.** After each answer, update your internal understanding and move to the next unresolved branch. Surface contradictions or new questions that the answer opened up.
5. **Signal completion.** When all major branches are resolved and no meaningful open questions remain, summarize the decisions made and confirm shared understanding.

## Rules

- **One question at a time.** Never bundle multiple questions in a single message.
- **Always give a recommendation.** Don't just ask — propose an answer and let the user accept, reject, or refine it.
- **Explore before asking.** If the answer is discoverable in the codebase (a file, a schema, an existing pattern), look it up instead of asking the user.
- **Challenge weak answers.** If the user's response is vague, incomplete, or introduces a new assumption, probe it before moving on.
- **Don't converge prematurely.** Reaching agreement on the easy questions doesn't mean the plan is solid. Press on the hard ones.
- **No padding.** Don't restate the entire plan back or summarize after every question. Keep momentum.

## Done means

Every meaningful branch of the decision tree has been walked to a resolved leaf. The user has explicit answers to all load-bearing questions, and you have confirmed shared understanding with a short summary of the key decisions.
