import assert from "node:assert/strict";
import test from "node:test";
import { notifyOutsideTui } from "./progress.ts";

function context(mode: "tui" | "rpc" | "print", hasUI: boolean) {
  const notifications: string[] = [];
  return {
    notifications,
    ctx: { mode, hasUI, ui: { notify: (message: string) => void notifications.push(message) } },
  };
}

test("RPC clients receive verifier progress as a notification", () => {
  const { ctx, notifications } = context("rpc", true);
  notifyOutsideTui(ctx, "Running project checks");
  assert.deepEqual(notifications, ["Running project checks"]);
});

test("the TUI relies on its project-checks panel instead of notifications", () => {
  const { ctx, notifications } = context("tui", true);
  notifyOutsideTui(ctx, "Running project checks");
  assert.deepEqual(notifications, []);
});

test("sessions without UI receive no notification", () => {
  const { ctx, notifications } = context("print", false);
  notifyOutsideTui(ctx, "Running project checks");
  assert.deepEqual(notifications, []);
});
