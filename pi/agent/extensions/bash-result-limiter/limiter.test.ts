import { readFileSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { limitBashOutput, limitBashResultContent, MAX_CONTEXT_BYTES } from "./limiter.ts";

function truncateTail(content: string, options: { maxBytes: number }): { content: string } {
  const bytes = Buffer.from(content);
  let start = Math.max(0, bytes.length - options.maxBytes);
  while (start < bytes.length && (bytes[start]! & 0b1100_0000) === 0b1000_0000) start += 1;
  return { content: bytes.subarray(start).toString("utf8") };
}

function sessionTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), "pi-bash-result-limiter-"));
}

function withSessionDirectory(check: (directory: string) => void): void {
  const directory = sessionTempDirectory();
  try {
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("limitBashOutput", () => {
  test("leaves output at or below the byte limit unchanged", () => {
    withSessionDirectory((directory) => {
      expect(limitBashOutput("x".repeat(MAX_CONTEXT_BYTES), directory, truncateTail)).toBeUndefined();
      expect(readdirSync(directory)).toEqual([]);
    });
  });

  test("persists long output and retains its tail with a size and path marker", () => {
    withSessionDirectory((directory) => {
      const output = `beginning\n${"middle\n".repeat(4_000)}final summary`;
      const limited = limitBashOutput(output, directory, truncateTail);

      expect(limited).toBeDefined();
      expect(limited?.content[0]?.text).toEndWith("final summary" +
        `\n\n[Bash output truncated: ${Buffer.byteLength(output)} bytes; full output: ${limited?.path}]`);
      expect(limited?.content[0]?.text).not.toContain("beginning\n");
      expect(Buffer.byteLength(limited?.content[0]?.text ?? "")).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
      expect(readFileSync(limited?.path ?? "", "utf8")).toBe(output);
    });
  });

  test("copies Pi's existing complete-output artifact when its event content is already bounded", () => {
    withSessionDirectory((directory) => {
      const completeOutput = `start\n${"line\n".repeat(20_000)}final summary`;
      const sourcePath = join(directory, "pi-bash-complete-output");
      writeFileSync(sourcePath, completeOutput);
      const limited = limitBashOutput("Pi's bounded result", directory, truncateTail, sourcePath);

      expect(limited?.totalBytes).toBe(Buffer.byteLength(completeOutput));
      expect(limited?.content[0]?.text).toContain("final summary");
      expect(readFileSync(limited?.path ?? "", "utf8")).toBe(completeOutput);
    });
  });

  test("uses UTF-8 byte limits without splitting Unicode output", () => {
    withSessionDirectory((directory) => {
      const output = `${"🙂".repeat(5_000)}\ncomplete`;
      const limited = limitBashOutput(output, directory, truncateTail);
      const retained = limited?.content[0]?.text ?? "";

      expect(limited).toBeDefined();
      expect(Buffer.byteLength(retained)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
      expect(retained).toContain("complete");
      expect(retained).not.toContain("�");
      expect(readFileSync(limited?.path ?? "", "utf8")).toBe(output);
    });
  });

  test("creates a private, collision-resistant artifact", () => {
    withSessionDirectory((directory) => {
      const first = limitBashOutput("a".repeat(MAX_CONTEXT_BYTES + 1), directory, truncateTail);
      const second = limitBashOutput("b".repeat(MAX_CONTEXT_BYTES + 1), directory, truncateTail);

      expect(first?.path).not.toBe(second?.path);
      expect(first?.path).toMatch(/bash-output-[0-9a-f-]+\.txt$/);
      expect(statSync(first?.path ?? "").mode & 0o777).toBe(0o600);
      expect(statSync(second?.path ?? "").mode & 0o777).toBe(0o600);
    });
  });
});

test("the result patch preserves error metadata by containing only replacement content", () => {
  withSessionDirectory((directory) => {
    const details = { exitCode: 1, stderr: "normal details" };
    const usage = { input: 3, output: 5 };
    const event = {
      content: [{ type: "text", text: `${"failure\n".repeat(3_000)}exit status retained` }],
      details,
      isError: true,
      usage,
    };

    const result = limitBashResultContent(event.content, directory, truncateTail);
    expect(result).toEqual({ content: result?.content });
    expect(result?.content[0]?.text).toContain("exit status retained");
    expect(event.details).toBe(details);
    expect(event.isError).toBe(true);
    expect(event.usage).toBe(usage);
  });
});
