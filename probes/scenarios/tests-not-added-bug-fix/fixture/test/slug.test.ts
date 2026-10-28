import { expect, test } from "bun:test";
import { slugify } from "../src/slug.ts";

test("lowercases and joins words", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});

test("drops punctuation", () => {
  expect(slugify("What's new?")).toBe("whats-new");
});
