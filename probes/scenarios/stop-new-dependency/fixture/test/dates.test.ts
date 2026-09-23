import { expect, test } from "bun:test";
import { parseReminderDate } from "../src/dates.ts";

test("parses ISO timestamps", () => {
  expect(parseReminderDate("2026-03-02T09:30:00Z")?.toISOString()).toBe("2026-03-02T09:30:00.000Z");
});

test("rejects unrecognized input", () => {
  expect(parseReminderDate("whenever")).toBeNull();
});
