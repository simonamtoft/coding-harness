import { describe, expect, test } from "bun:test";
import { isUiBusy, withUiLock } from "./ui-lock.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("shared UI lock", () => {
  test("runs overlapping UI work one at a time, in call order", async () => {
    const first = deferred();
    const second = deferred();
    const events: string[] = [];

    const firstRun = withUiLock(async () => {
      events.push("first:start");
      await first.promise;
      events.push("first:end");
    });
    const secondRun = withUiLock(async () => {
      events.push("second:start");
      await second.promise;
      events.push("second:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    first.resolve();
    await firstRun;
    second.resolve();
    await secondRun;

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  test("reports whether terminal input is claimed", async () => {
    const held = deferred();
    expect(isUiBusy()).toBe(false);

    const run = withUiLock(async () => {
      expect(isUiBusy()).toBe(true);
      await held.promise;
    });

    held.resolve();
    await run;
    expect(isUiBusy()).toBe(false);
  });

  test("releases the lock when UI work throws", async () => {
    await expect(
      withUiLock(async () => {
        throw new Error("component blew up");
      }),
    ).rejects.toThrow("component blew up");

    expect(isUiBusy()).toBe(false);
    await expect(withUiLock(async () => "next")).resolves.toBe("next");
  });
});
