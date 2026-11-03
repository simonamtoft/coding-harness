/**
 * Coordinates review of agent edits to the project verifier between
 * `verify-turn`, which detects the edit, and `subagent`, which owns reviewer
 * dispatch. Every outcome other than an explicit clear verdict is `undecided`,
 * so a missing, failed, or malformed review never lets a changed verifier run
 * unreviewed.
 */

export type VerifierChangeVerdict = "clear" | "circumvents" | "undecided";

export interface VerifierChangeReview {
	verdict: VerifierChangeVerdict;
	report: string;
}

export interface VerifierChangeReviewRequest {
	cwd: string;
	/** Commit the bundle diffs against; undefined lets the bundle script resolve the default-branch merge base. */
	base?: string;
	verifierPath: string;
	/** Entry point accepted before this edit; undefined when the session had no verifier. */
	acceptedPath?: string;
	/** Accepted entry-point text; undefined when there was none or it was too large to carry. */
	acceptedContent?: string;
	changedPaths: string[];
	model?: string;
	thinkingLevel?: string;
	signal: AbortSignal;
}

type VerifierChangeReviewer = (request: VerifierChangeReviewRequest) => Promise<VerifierChangeReview>;

/**
 * The registration lives on globalThis rather than in module scope: pi loads each extension through its
 * own module registry, so `subagent` (which registers) and `verify-turn` (which asks) each get a separate
 * copy of this file.
 */
const REVIEWER_KEY = "__piVerifierChangeReviewer";

export function registerVerifierChangeReviewer(next: VerifierChangeReviewer | undefined): void {
	(globalThis as Record<string, unknown>)[REVIEWER_KEY] = next;
}

function registeredReviewer(): VerifierChangeReviewer | undefined {
	return (globalThis as Record<string, unknown>)[REVIEWER_KEY] as VerifierChangeReviewer | undefined;
}

const VERDICT_LINE = /^VERDICT:\s*(CLEAR|CIRCUMVENTS)\s*$/;

export function parseVerifierChangeVerdict(output: string): VerifierChangeReview {
	const report = output.trim();
	const firstLine = report.split("\n").find((line) => line.trim())?.trim() ?? "";
	const match = VERDICT_LINE.exec(firstLine);
	if (!match) {
		return {
			verdict: "undecided",
			report: `The reviewer did not start with a VERDICT line.\n\n${report || "(no output)"}`,
		};
	}
	return { verdict: match[1] === "CLEAR" ? "clear" : "circumvents", report };
}

export async function reviewVerifierChange(request: VerifierChangeReviewRequest): Promise<VerifierChangeReview> {
	const reviewer = registeredReviewer();
	if (!reviewer) {
		return { verdict: "undecided", report: "No verifier-change reviewer is available; the subagent extension is not loaded." };
	}
	try {
		return await reviewer(request);
	} catch (error) {
		if (request.signal.aborted) throw error;
		const message = error instanceof Error ? error.message : String(error);
		return { verdict: "undecided", report: `The verifier-change review failed: ${message}` };
	}
}
