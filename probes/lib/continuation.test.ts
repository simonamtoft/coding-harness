import { describe, expect, test } from "bun:test";

import { HANDOFF_FILE, handoffRequest, resumePrompt } from "./continuation.ts";

describe("handoff prompts", () => {
  test("asks for the handoff in the runner-named file and forbids continuing", () => {
    const request = handoffRequest();
    expect(request).toContain(`Write a handoff note to ${HANDOFF_FILE}`);
    expect(request).toContain("Do not continue the task itself.");
  });

  test("pastes the handoff note after the continuation prompt", () => {
    expect(resumePrompt("Finish the migration.", "  Steps 1-2 done.\n")).toBe(
      "Finish the migration.\n\nHandoff note from the previous session:\n\n<handoff>\nSteps 1-2 done.\n</handoff>",
    );
  });

  test("says plainly when the previous session left no note", () => {
    expect(resumePrompt("Finish the migration.", null)).toBe("Finish the migration.\n\nThe previous session left no handoff note.");
    expect(resumePrompt("Finish the migration.", " \n")).toEndWith("The previous session left no handoff note.");
  });
});
