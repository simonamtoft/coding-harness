import assert from "node:assert/strict";
import test from "node:test";
import {
	parseVerifierChangeVerdict,
	registerVerifierChangeReviewer,
	reviewVerifierChange,
	type VerifierChangeReviewRequest,
} from "./verifier-change-review.ts";

const request = (signal = new AbortController().signal): VerifierChangeReviewRequest => ({
	cwd: "/repo",
	verifierPath: ".agent/verify.sh",
	changedPaths: [".agent/verify.sh"],
	signal,
});

test("only an exact leading VERDICT line decides the review", () => {
	assert.equal(parseVerifierChangeVerdict("\nVERDICT: CLEAR\nAdds a lint step.").verdict, "clear");
	assert.equal(parseVerifierChangeVerdict("VERDICT: CIRCUMVENTS\n- verify.sh:4").verdict, "circumvents");
	assert.equal(parseVerifierChangeVerdict("Looks fine.\nVERDICT: CLEAR").verdict, "undecided");
	assert.equal(parseVerifierChangeVerdict("VERDICT: CLEAR, mostly").verdict, "undecided");
	assert.equal(parseVerifierChangeVerdict("").verdict, "undecided");
});

test("a missing or failing reviewer is undecided, never clear", async () => {
	registerVerifierChangeReviewer(undefined);
	assert.equal((await reviewVerifierChange(request())).verdict, "undecided");

	registerVerifierChangeReviewer(async () => {
		throw new Error("bundle failed");
	});
	const failed = await reviewVerifierChange(request());
	assert.equal(failed.verdict, "undecided");
	assert.match(failed.report, /bundle failed/);
	registerVerifierChangeReviewer(undefined);
});

test("cancellation propagates instead of becoming a verdict", async () => {
	const controller = new AbortController();
	registerVerifierChangeReviewer(async () => {
		controller.abort();
		throw new Error("aborted");
	});
	await assert.rejects(reviewVerifierChange(request(controller.signal)), /aborted/);
	registerVerifierChangeReviewer(undefined);
});

test("the registered reviewer's verdict is returned", async () => {
	registerVerifierChangeReviewer(async () => ({ verdict: "circumvents", report: "VERDICT: CIRCUMVENTS" }));
	assert.equal((await reviewVerifierChange(request())).verdict, "circumvents");
	registerVerifierChangeReviewer(undefined);
});
