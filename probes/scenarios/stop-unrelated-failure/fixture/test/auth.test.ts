import { expect, test } from "bun:test";
import { isSessionExpired } from "../src/auth.ts";

test("a session expires exactly at the end of its lifetime", () => {
  const issuedAt = new Date("2026-01-01T12:00:00Z");
  expect(isSessionExpired(issuedAt, new Date("2026-01-01T12:30:00Z"))).toBe(true);
});
