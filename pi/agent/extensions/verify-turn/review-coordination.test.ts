import assert from "node:assert/strict";
import test from "node:test";
import {
	releaseReviewAfterVerification,
	requestReview,
	resetReviewCoordination,
	setAutomaticVerifierAvailable,
	type ReviewRequest,
} from "../shared/review-coordination.ts";

const request: ReviewRequest = {
	base: "origin/main",
	focus: ["src/orchestrator.ts"],
	security: true,
};

test("defers a review until verification succeeds, preserving its options", () => {
	resetReviewCoordination();
	setAutomaticVerifierAvailable(true);

	assert.equal(requestReview(request), "deferred");
	assert.equal(releaseReviewAfterVerification(), request);
	assert.equal(requestReview(request), "run");
});

test("does not release a review before successful verification or schedule it again", () => {
	resetReviewCoordination();
	setAutomaticVerifierAvailable(true);

	assert.equal(requestReview(request), "deferred");
	assert.equal(requestReview(request), "already-deferred");
	assert.equal(releaseReviewAfterVerification(), request);
	assert.equal(releaseReviewAfterVerification(), undefined);
	assert.equal(requestReview(request), "run");
	assert.equal(releaseReviewAfterVerification(), undefined);
});

test("runs reviews immediately when no automatic verifier is available", () => {
	resetReviewCoordination();
	setAutomaticVerifierAvailable(false);

	assert.equal(requestReview(request), "run");
	assert.equal(releaseReviewAfterVerification(), undefined);
});

test("runs an explicit review immediately without consuming a deferred review", () => {
	resetReviewCoordination();
	setAutomaticVerifierAvailable(true);

	assert.equal(requestReview(request, false), "run");
	assert.equal(releaseReviewAfterVerification(), undefined);
});

test("verify-turn's verifier flag and release reach subagent's module copy", async () => {
	// Pi loads each extension through its own module registry; query strings give Bun separate copies.
	const verifyTurnCopy = await import("../shared/review-coordination.ts?extension=verify-turn");
	const subagentCopy = await import("../shared/review-coordination.ts?extension=subagent");
	verifyTurnCopy.resetReviewCoordination();
	verifyTurnCopy.setAutomaticVerifierAvailable(true);
	assert.equal(subagentCopy.requestReview(request), "deferred");
	assert.deepEqual(subagentCopy.releaseReviewAfterVerification(), request);
	assert.equal(subagentCopy.requestReview(request), "run");
	verifyTurnCopy.resetReviewCoordination();
});
