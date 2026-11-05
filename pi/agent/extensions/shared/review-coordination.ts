export interface ReviewRequest {
	base?: string;
	focus?: string[];
	security?: boolean;
}

type ReviewDisposition = "run" | "deferred" | "already-deferred";

interface ReviewCoordinationState {
	automaticVerifierAvailable: boolean;
	pendingReview?: ReviewRequest;
	releasedReview?: ReviewRequest;
}

const STATE_KEY = "__piReviewCoordination";

/**
 * The state lives on globalThis rather than in module scope: pi loads each extension through its own
 * module registry, so `verify-turn` and `subagent` each get a separate copy of this file.
 */
function state(): ReviewCoordinationState {
	const globals = globalThis as Record<string, unknown>;
	globals[STATE_KEY] ??= { automaticVerifierAvailable: false } satisfies ReviewCoordinationState;
	return globals[STATE_KEY] as ReviewCoordinationState;
}

export function resetReviewCoordination(): void {
	const current = state();
	current.automaticVerifierAvailable = false;
	current.pendingReview = undefined;
	current.releasedReview = undefined;
}

export function setAutomaticVerifierAvailable(available: boolean): void {
	state().automaticVerifierAvailable = available;
}

function sameRequest(left: ReviewRequest, right: ReviewRequest): boolean {
	return (
		left.base === right.base &&
		left.security === right.security &&
		JSON.stringify(left.focus ?? []) === JSON.stringify(right.focus ?? [])
	);
}

export function requestReview(request: ReviewRequest, defer = true): ReviewDisposition {
	if (!defer) return "run";
	const current = state();
	if (current.releasedReview && sameRequest(current.releasedReview, request)) {
		current.releasedReview = undefined;
		return "run";
	}
	if (!current.automaticVerifierAvailable) return "run";
	if (current.pendingReview) return "already-deferred";
	current.pendingReview = request;
	return "deferred";
}

export function releaseReviewAfterVerification(): ReviewRequest | undefined {
	const current = state();
	if (!current.pendingReview) return undefined;
	current.releasedReview = current.pendingReview;
	current.pendingReview = undefined;
	return current.releasedReview;
}
