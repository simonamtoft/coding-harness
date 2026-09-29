import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keepAwake } from "./index.ts";

test("holds the sleep assertion through verification and releases it afterward", () => {
  const handlers = new Map<string, () => void>();
  let started = 0;
  let stopped = 0;
  const pi = {
    on: (event: string, handler: () => void) => { handlers.set(event, handler); },
    events: { on: (event: string, handler: () => void) => { handlers.set(event, handler); } },
  } as unknown as ExtensionAPI;
  keepAwake(pi, () => {
    started++;
    return {
      kill: () => { stopped++; return true; },
      unref: () => {},
      on: () => {},
    };
  });
  const emit = (event: string) => {
    const handler = handlers.get(event);
    assert.ok(handler, `handler for ${event}`);
    handler();
  };

  emit("agent_start");
  assert.equal(started, 1);
  emit("verify-turn:started"); // Verification starts before or after the settle handler runs.
  emit("agent_settled");
  assert.equal(stopped, 0);
  assert.equal(started, 1);
  emit("agent_start"); // A failure can queue a repair turn before the verifier finishes.
  emit("verify-turn:finished");
  assert.equal(stopped, 0);
  emit("agent_settled");
  assert.equal(stopped, 1);

  emit("agent_start");
  emit("agent_settled"); // Verification skipped.
  assert.equal(started, 2);
  assert.equal(stopped, 2);
  emit("verify-turn:started"); // Later handler ordering must also acquire the assertion.
  assert.equal(started, 3);
  emit("verify-turn:finished");
  assert.equal(stopped, 3);
  emit("verify-turn:started");
  emit("session_shutdown"); // Cancellation or session replacement.
  assert.equal(stopped, 4);
});
