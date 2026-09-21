import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import secretResultGuard from "./index.ts";
import { BLOCKED_RESULT_TEXT, protectedEnvironmentValues, sanitizeToolResult } from "./guard.ts";

const TEST_SECRET = "HELLO WORLD!";

describe("protectedEnvironmentValues", () => {
  test("selects secret-like variables and deduplicates their values", () => {
    expect(protectedEnvironmentValues({
      TMP_API_KEY: TEST_SECRET,
      SERVICE_TOKEN: TEST_SECRET,
      SSH_PRIVATE_KEY: "private-key-material",
      HOME: "/Users/example",
    })).toEqual([TEST_SECRET, "private-key-material"]);
  });

  test("selects explicitly named variables without protecting the selector itself", () => {
    expect(protectedEnvironmentValues({
      PI_PROTECTED_ENV_VARS: "DOTNET_ROOT, CUSTOM_VALUE",
      DOTNET_ROOT: "/opt/dotnet-test",
      CUSTOM_VALUE: "custom-value",
    })).toEqual(["/opt/dotnet-test", "custom-value"]);
  });

  test("ignores short heuristic values but honors non-empty explicit values", () => {
    expect(protectedEnvironmentValues({
      PI_PROTECTED_ENV_VARS: "SHORT_VALUE, EMPTY_VALUE",
      SHORT_TOKEN: "token",
      SHORT_VALUE: "short",
      EMPTY_VALUE: "",
    })).toEqual(["short"]);
  });
});

describe("sanitizeToolResult", () => {
  test("replaces matching content without retaining the protected value", () => {
    const result = sanitizeToolResult(
      [{ type: "text", text: `configuration: ${TEST_SECRET}` }],
      { path: "/tmp/example" },
      [TEST_SECRET],
    );

    expect(result).toEqual({
      content: [{ type: "text", text: BLOCKED_RESULT_TEXT }],
      details: { blocked: true, reason: "protected-environment-value" },
      isError: true,
    });
    expect(JSON.stringify(result)).not.toContain(TEST_SECRET);
  });

  test("also replaces a result when only nested details contain the value", () => {
    const result = sanitizeToolResult(
      [{ type: "text", text: "bounded output" }],
      { nested: { fullOutput: TEST_SECRET } },
      [TEST_SECRET],
    );

    expect(result?.content[0]?.text).toBe(BLOCKED_RESULT_TEXT);
    expect(JSON.stringify(result)).not.toContain(TEST_SECRET);
  });

  test("leaves non-matching and unprotected results unchanged", () => {
    expect(sanitizeToolResult([{ type: "text", text: "safe" }], {}, [TEST_SECRET])).toBeUndefined();
    expect(sanitizeToolResult([{ type: "text", text: TEST_SECRET }], {}, [])).toBeUndefined();
  });
});

test("extension sanitizes finalized results from any tool using the process environment", () => {
  const previous = process.env.TMP_API_KEY;
  process.env.TMP_API_KEY = TEST_SECRET;
  try {
    let handler: ((event: { content: unknown[]; details: unknown }) => unknown) | undefined;
    secretResultGuard({
      on: (event: string, callback: typeof handler) => {
        expect(event).toBe("tool_result");
        handler = callback;
      },
    } as unknown as ExtensionAPI);

    const result = handler?.({
      content: [{ type: "text", text: `read: ${TEST_SECRET}` }],
      details: { original: TEST_SECRET },
    });

    expect(JSON.stringify(result)).not.toContain(TEST_SECRET);
    expect(result).toEqual({
      content: [{ type: "text", text: BLOCKED_RESULT_TEXT }],
      details: { blocked: true, reason: "protected-environment-value" },
      isError: true,
    });
  } finally {
    if (previous === undefined) delete process.env.TMP_API_KEY;
    else process.env.TMP_API_KEY = previous;
  }
});
