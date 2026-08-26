import assert from "node:assert/strict";
import test from "node:test";
import { formatVerificationLiveness } from "./liveness.ts";

test("reports a running verifier before it emits output", () => {
  assert.equal(
    formatVerificationLiveness(10_000, undefined, 15_900),
    "Verifier is running · 5s elapsed · no output yet",
  );
});

test("reports elapsed time since the latest verifier output", () => {
  assert.equal(
    formatVerificationLiveness(10_000, 14_500, 20_900),
    "Verifier is running · 10s elapsed · last output 6s ago",
  );
});

test("does not report negative durations when timestamps are refreshed out of order", () => {
  assert.equal(
    formatVerificationLiveness(10_000, 12_000, 11_000),
    "Verifier is running · 1s elapsed · last output 0s ago",
  );
});
