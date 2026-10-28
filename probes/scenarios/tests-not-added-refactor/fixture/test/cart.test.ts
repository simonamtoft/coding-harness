import { expect, test } from "bun:test";
import { cartTotal } from "../src/cart.ts";

test("sums lines", () => {
  expect(cartTotal([100, 250])).toBe(350);
});
