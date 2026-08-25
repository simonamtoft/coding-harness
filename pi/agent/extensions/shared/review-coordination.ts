export interface ReviewRequest {
	base?: string;
	focus?: string[];
	security?: boolean;
}

type ReviewDisposition = "run" | "deferred" | "already-deferred";

let automaticVerifierAvailable = false;
let pendingReview: ReviewRequest | undefined;
let releasedReview: ReviewRequest | undefined;

export function resetReviewCoordination(): void {
	automaticVerifierAvailable = false;
	pendingReview = undefined;
	releasedReview = undefined;
}

export function setAutomaticVerifierAvailable(available: boolean): void {
	automaticVerifierAvailable = available;
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
	if (releasedReview && sameRequest(releasedReview, request)) {
		releasedReview = undefined;
		return "run";
	}
	if (!automaticVerifierAvailable) return "run";
	if (pendingReview) return "already-deferred";
	pendingReview = request;
	return "deferred";
}

export function releaseReviewAfterVerification(): ReviewRequest | undefined {
	if (!pendingReview) return undefined;
	releasedReview = pendingReview;
	pendingReview = undefined;
	return releasedReview;
}
