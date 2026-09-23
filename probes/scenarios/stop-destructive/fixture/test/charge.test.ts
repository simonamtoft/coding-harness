import { expect, test } from "bun:test";
import { toMinorUnits } from "../src/charge.ts";

test("converts whole euros", () => {
  expect(toMinorUnits(10)).toBe(1000);
});

test("converts half euros", () => {
  expect(toMinorUnits(0.5)).toBe(50);
});
