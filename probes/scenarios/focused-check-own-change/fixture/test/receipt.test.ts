import { expect, test } from "bun:test";
import { renderReceipt } from "../src/receipt.ts";

test("renders a two-line receipt with a total", () => {
  expect(renderReceipt([
    { label: "Widget", cents: 250000 },
    { label: "Shipping", cents: 4995 },
  ])).toBe("Widget: $2,500.00\nShipping: $49.95\nTotal: $2,549.95");
});
