---
name: technical-writing
description: Draft or structurally review technical documentation, RFCs, runbooks, tutorials, and developer guides. Use for document purpose, organization, technical clarity, and repository-grounded accuracy; not for generic prose cleanup, translation, CVs, UI copy, routine commit messages, or task-spec synthesis.
---

# Technical writing

Create or review technical documents that help a specific reader learn, complete a task, find facts, understand a system, make a decision, or operate it safely.

## Scope and boundaries

Use this skill when the requested work includes a technical document's purpose, structure, completeness, navigation, instructional flow, or technical accuracy. It supports both new drafts and structural reviews of existing documents.

Do not use it for generic prose cleanup, translation, CVs, UI copy, or routine commit messages. Use `humanize-writing` when the request is to remove formulaic prose while preserving the source's meaning and structure. Use `to-spec` when the request is to synthesize the current conversation into a task specification and publish it to the tracker. If a technical document also needs humanization, treat that as a separate, explicitly requested final pass; never let it alter verified terminology or technical meaning.

This workflow is self-contained. It does not require pstack `unslop` or another cleanup skill.

## Workflow

1. **Establish the contract.** Identify:
   - the intended audience and what knowledge they can be assumed to have;
   - the reader's purpose and the outcome the document should enable;
   - the document type, scope, constraints, and requested authoring or review depth.

   Infer these from the request and repository when they are clear. Ask only when a missing answer would materially change the document.

2. **Inspect the source of truth.** Read the relevant repository documentation, domain context, implementation, configuration, and tests. Reuse the project's exact terminology. Verify every symbol, option, path, command, output, prerequisite, and behavioral claim against the repository or another authoritative source. Run commands when practical and safe. Do not invent details to fill gaps; label unresolved assumptions or ask for the missing information.

3. **Choose the document shape.** Use Diátaxis as a document-level lens, based on the reader's purpose:
   - **Tutorial:** a guided learning experience that produces observable progress.
   - **How-to guide:** task-focused steps for a reader who has a concrete goal.
   - **Reference:** accurate, consistent, navigable facts that support lookup.
   - **Explanation:** context, reasoning, relationships, and tradeoffs that build understanding.

   RFCs, runbooks, developer guides, and other real documents may combine these needs. Give the document or each clearly marked section a dominant purpose rather than forcing the whole document into one mode. Separate modes when mixing them would obscure the reader's path.

4. **Draft or review around the reader's path.** Put prerequisites and critical constraints before the steps that depend on them. Prefer concrete examples, expected results, recovery or rollback information where operationally relevant, and links between concepts and exact repository artifacts. For RFCs, make the problem, decision drivers, proposal, alternatives, consequences, and unresolved questions easy to locate. Remove sections that do not help the stated audience achieve the stated purpose.

5. **Check the document.** Confirm that:
   - the opening sets the audience, purpose, scope, and expected outcome as needed;
   - headings and order make the reader's path clear;
   - terminology is consistent with the repository;
   - instructions state prerequisites, actions, expected results, and important failure handling;
   - symbols, paths, commands, examples, links, and technical claims are verified;
   - uncertainty, version limits, and unverified assumptions are visible rather than presented as facts.

## Style heuristics

Optimize for reader effort and technical precision, not compliance with mechanical style rules.

- Prefer direct, specific language and concrete nouns and verbs.
- Use active voice when it makes the actor or action clearer; use passive voice when the actor is unknown, irrelevant, or less important than the result.
- Keep sentences and paragraphs focused, but let complex ideas take the space they need.
- Use lists, tables, diagrams, examples, and punctuation when they improve scanning or comprehension.
- Keep instructions action-oriented and explanations sufficiently reasoned; do not flatten every section into one prose mode.
- Avoid unexplained jargon, filler, promotional language, and abstract claims that the evidence does not support.

Sentence length, voice, punctuation, and document-mode purity are contextual choices, not absolute prohibitions.

## Output

For an authoring request, return the document in the requested repository location or format. For a review-only request, do not silently rewrite the source: report prioritized structural and technical findings with concrete locations and suggested changes. If the user requests both, provide the revised document and briefly call out unresolved evidence gaps or material structural decisions.
