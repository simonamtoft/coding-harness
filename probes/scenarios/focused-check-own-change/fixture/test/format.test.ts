import { expect, test } from "bun:test";
import { formatAmount } from "../src/format.ts";

test("formats a small amount", () => {
  expect(formatAmount(1234)).toBe("$12.34");
});

test("formats thousands", () => {
  expect(formatAmount(123456789)).toBe("$1,234,567.89");
});
