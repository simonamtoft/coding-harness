import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deniedBashCommandReason } from "./policy.ts";

const fixturePath = fileURLToPath(new URL("../../../../shared/command-safety.tsv", import.meta.url));
const fixture = readFileSync(fixturePath, "utf8")
  .split("\n")
  .flatMap((line) => {
    if (!line || line.startsWith("#")) return [];
    const [expected, command] = line.split("\t", 2);
    return expected && command ? [{ expected, command }] : [];
  });

for (const { expected, command } of fixture) {
  test(`shared command-safety contract: ${expected} ${command}`, () => {
    const reason = deniedBashCommandReason(command, "/Users/example/project", "/Users/example");
    if (expected === "deny") {
      assert.ok(reason, `expected an actionable denial reason for: ${command}`);
    } else {
      assert.equal(reason, undefined, `expected the policy not to hard-block: ${command}`);
    }
  });
}
