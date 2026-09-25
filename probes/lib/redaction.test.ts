import { describe, expect, test } from "bun:test";

import { redact, redactJson, scanForSecrets, secretEnvValues, type RedactionContext } from "./redaction.ts";

const context: RedactionContext = {
  secrets: ["env-secret-value-1234"],
  home: "/Users/alice",
  user: "alice",
  host: "alices-mbp",
};

const tokens = {
  anthropic: `sk-ant-api03-${"a".repeat(30)}`,
  openai: `sk-proj-${"b".repeat(30)}`,
  github: `ghp_${"c".repeat(36)}`,
  aws: "AKIAABCDEFGHIJKLMNOP",
  jwt: `eyJ${"d".repeat(12)}.${"e".repeat(12)}.${"f".repeat(12)}`,
};

describe("secretEnvValues", () => {
  test("takes secret-named variables long enough to matter, not look-alikes", () => {
    expect(secretEnvValues({
      ANTHROPIC_API_KEY: "a-long-secret-value",
      GITHUB_TOKEN: "another-long-value",
      GIT_AUTHOR_NAME: "Alice Example",
      MONKEY: "not-a-secret-at-all",
      SHORT_TOKEN: "1234",
      PATH: "/usr/bin",
    })).toEqual(["a-long-secret-value", "another-long-value"]);
  });
});

describe("redact", () => {
  test("replaces env secret values, known token formats, home, user, and host", () => {
    const text = [
      "key env-secret-value-1234 used",
      ...Object.values(tokens),
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
      "/Users/alice/work/repo alice@alices-mbp",
    ].join("\n");
    expect(redact(text, context)).toBe([
      "key [REDACTED:env] used",
      "[REDACTED:anthropic-key]",
      "[REDACTED:openai-key]",
      "[REDACTED:github-token]",
      "[REDACTED:aws-access-key]",
      "[REDACTED:jwt]",
      "Authorization: [REDACTED:bearer]",
      "[REDACTED:private-key]",
      "~/work/repo [user]@[host]",
    ].join("\n"));
  });

  test("leaves ordinary words that contain a token prefix alone", () => {
    expect(redact("run the task-runner-for-the-benchmark-suite", context)).toBe("run the task-runner-for-the-benchmark-suite");
  });

  test("redacts every string of a JSON value, keys included", () => {
    expect(redactJson({ "/Users/alice/x": [tokens.github, 3, null] }, context)).toEqual({ "~/x": ["[REDACTED:github-token]", 3, null] });
  });
});

describe("scanForSecrets", () => {
  test("finds nothing in redacted text", () => {
    expect(scanForSecrets(redact(`${tokens.anthropic} /Users/alice`, context), context)).toEqual([]);
  });

  test("reports what redaction does not rewrite by kind and line only", () => {
    const findings = scanForSecrets("first line\nconfig: password = hunter2hunter2 next to other-secret", context);
    expect(findings).toEqual([{ kind: "suspicious-assignment", line: 2 }]);
  });

  test("catches credential assignments with underscore-delimited names but not look-alike words", () => {
    for (const line of ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENG", "DB_PASSWORD=correcthorse", "aws_secret_access_key = wJalrXUtnFEMIK7MDENG", "SERVICE_API_KEY: abcdefgh1234"]) {
      expect(scanForSecrets(line, context).map((finding) => finding.kind)).toEqual(["suspicious-assignment"]);
    }
    expect(scanForSecrets("tokenizer: sentencepiece-model", context)).toEqual([]);
  });

  test("reports unredacted secrets as a safety net", () => {
    expect(scanForSecrets("leaked env-secret-value-1234 and /Users/alice", context).map((finding) => finding.kind)).toEqual(["env-secret", "home", "user"]);
  });
});
