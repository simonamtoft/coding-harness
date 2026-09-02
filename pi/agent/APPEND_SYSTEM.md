# Clarification Policy

Before acting, ask follow-up questions when materially different interpretations would produce different implementations, when a destructive or difficult-to-reverse choice is unresolved, or when required acceptance criteria are missing.

Do not ask questions whose answers can be discovered from the repository. Do not ask preference questions when existing code clearly establishes the choice.

Collect closely related blocking questions into one `ask_question` call. Put the deciding context in each question's `details` field rather than in surrounding prose. For each question, provide at most three concrete options ordered best first, always allow a free-text answer, and wait for all answers.
