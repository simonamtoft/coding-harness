import assert from "node:assert/strict";
import test from "node:test";
import {
	releaseReviewAfterVerification,
	requestReview,
	resetReviewCoordination,
	setAutomaticVerifierAvailable,
	type ReviewRequest,
} from "../review-coordination.ts";

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
