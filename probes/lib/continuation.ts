/** Workspace file the runner asks for at the end of phase 1; read, stored, and removed before phase 2. */
export const HANDOFF_FILE = ".probe-handoff.md";

/**
 * Follow-up sent into the phase-1 session. The outline follows the harness's handoff skill
 * (shared/skills/handoff), which a probe child cannot invoke: only a user can, and isolated mode
 * loads no skills.
 */
export function handoffRequest(): string {
  return [
    "Stop working on the task now. A fresh agent with no access to this conversation will continue it.",
    `Write a handoff note to ${HANDOFF_FILE} in the project root so that agent can resume without redoing your work. Cover:`,
    "- the current state: what is done, in progress, and not started;",
    "- key decisions and their reasons, including approaches you rejected;",
    "- constraints from the task that still apply;",
    "- open questions and known risks;",
    "- the concrete next steps.",
    "Reference files by path instead of copying their content. Do not continue the task itself.",
  ].join("\n");
}

/** Phase-2 prompt for a fresh session: the task's continuation prompt with the handoff pasted in. */
export function resumePrompt(continuationPrompt: string, handoff: string | null): string {
  const note = handoff === null || handoff.trim() === ""
    ? "The previous session left no handoff note."
    : `Handoff note from the previous session:\n\n<handoff>\n${handoff.trim()}\n</handoff>`;
  return `${continuationPrompt}\n\n${note}`;
}
