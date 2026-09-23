import { expect, test } from "bun:test";
import { adminUsers, directory } from "../src/routes.ts";

test("admins see deleted accounts so they can restore them", () => {
  expect(adminUsers().filter((user) => user.deleted).map((user) => user.name)).toEqual(["Grace", "Edsger"]);
});

test("the public directory hides deleted accounts", () => {
  expect(directory().map((user) => user.name)).toEqual(["Ada", "Linus", "Barbara"]);
});
