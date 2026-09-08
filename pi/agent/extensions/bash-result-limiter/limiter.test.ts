import { readFileSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { limitBashResultContent, MAX_CONTEXT_BYTES } from "./limiter.ts";

const ARTIFACT_PREFIX = "bash-output-";

function withSessionDirectory(check: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "pi-bash-result-limiter-"));
  try {
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function artifacts(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.startsWith(ARTIFACT_PREFIX)).map((name) => join(directory, name));
}

function limit(text: string, directory: string | undefined, fullOutputPath?: string) {
  return limitBashResultContent([{ type: "text", text }], directory, fullOutputPath);
}

function retainedText(result: ReturnType<typeof limitBashResultContent>): string {
  return result?.content[0]?.text ?? "";
}

describe("limitBashResultContent", () => {
  test("leaves output at or below the byte limit unchanged", () => {
    withSessionDirectory((directory) => {
      expect(limit("x".repeat(MAX_CONTEXT_BYTES), directory)).toBeUndefined();
      expect(readdirSync(directory)).toEqual([]);
    });
  });

  test("leaves output unchanged when no session directory is available", () => {
    expect(limit("x".repeat(MAX_CONTEXT_BYTES + 1), undefined)).toBeUndefined();
  });

  test("persists long output and retains its tail with a size and path marker", () => {
    withSessionDirectory((directory) => {
      const output = `beginning\n${"middle\n".repeat(4_000)}final summary`;
      const limited = limit(output, directory);
      const path = limited?.fullOutputPath;

      expect(artifacts(directory)).toEqual([path!]);
      expect(retainedText(limited)).toEndWith("final summary" +
        `\n\n[Bash output truncated: ${Buffer.byteLength(output)} bytes; full output: ${path}]`);
      expect(retainedText(limited)).not.toContain("beginning\n");
      expect(Buffer.byteLength(retainedText(limited))).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
      expect(readFileSync(path ?? "", "utf8")).toBe(output);
    });
  });

  test("uses UTF-8 byte limits without splitting Unicode output", () => {
    withSessionDirectory((directory) => {
      const output = `${"🙂".repeat(5_000)}\ncomplete`;
      const limited = limit(output, directory);
      const [path] = artifacts(directory);

      expect(Buffer.byteLength(retainedText(limited))).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
      expect(retainedText(limited)).toContain("complete");
      expect(retainedText(limited)).not.toContain("\uFFFD");
      expect(readFileSync(path ?? "", "utf8")).toBe(output);
    });
  });

  test("creates a private, collision-resistant artifact", () => {
    withSessionDirectory((directory) => {
      limit("a".repeat(MAX_CONTEXT_BYTES + 1), directory);
      limit("b".repeat(MAX_CONTEXT_BYTES + 1), directory);
      const created = artifacts(directory);

      expect(created).toHaveLength(2);
      for (const path of created) {
        expect(path).toMatch(/bash-output-[0-9a-f-]+\.txt$/);
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
    });
  });

  test("leaves the caller's event untouched and names the artifact it created", () => {
    withSessionDirectory((directory) => {
      const details = { exitCode: 1, stderr: "normal details" };
      const usage = { input: 3, output: 5 };
      const event = {
        content: [{ type: "text", text: `${"failure\n".repeat(3_000)}exit status retained` }],
        details,
        isError: true,
        usage,
      };

      const result = limitBashResultContent(event.content, directory);

      expect(Object.keys(result ?? {}).sort()).toEqual(["content", "fullOutputPath"]);
      expect(result?.fullOutputPath).toBe(artifacts(directory)[0]!);
      expect(retainedText(result)).toContain("exit status retained");
      expect(event.details).toBe(details);
      expect(event.isError).toBe(true);
      expect(event.usage).toBe(usage);
    });
  });
});

describe("output already spilled to a file by Pi", () => {
  function spill(directory: string, contents: string): string {
    const path = join(directory, "pi-output-spilled.log");
    writeFileSync(path, contents);
    return path;
  }

  test("copies the spilled artifact and reports its size, not the bounded event content", () => {
    withSessionDirectory((directory) => {
      const completeOutput = `start\n${"line\n".repeat(20_000)}final summary`;
      const sourcePath = spill(directory, completeOutput);

      const limited = limit("Pi's bounded result", directory, sourcePath);
      const path = limited?.fullOutputPath;

      expect(path).not.toBe(sourcePath);
      expect(retainedText(limited)).toEndWith(
        `\n\n[Bash output truncated: ${Buffer.byteLength(completeOutput)} bytes; full output: ${path}]`);
      expect(retainedText(limited)).toContain("final summary");
      expect(retainedText(limited)).not.toContain("Pi's bounded result");
      expect(Buffer.byteLength(retainedText(limited))).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
      expect(readFileSync(path ?? "", "utf8")).toBe(completeOutput);
    });
  });

  test("retains whole lines when the tail window opens mid-line", () => {
    withSessionDirectory((directory) => {
      const sourcePath = spill(directory, `${"padding ".repeat(4_000)}\nkept line\nfinal summary`);

      const retained = retainedText(limit("bounded", directory, sourcePath));

      expect(retained).toStartWith("kept line\nfinal summary");
      expect(retained).not.toContain("padding");
    });
  });

  test("reads the spilled tail without splitting Unicode characters", () => {
    withSessionDirectory((directory) => {
      const lineBreaks = spill(directory, `${"🙂".repeat(10_000)}\n${"🙂".repeat(3_000)}\ntail line`);
      const singleLine = join(directory, "pi-output-single-line.log");
      writeFileSync(singleLine, "🙂".repeat(20_000));

      const withLineBreaks = retainedText(limit("bounded", directory, lineBreaks));
      const withoutLineBreaks = retainedText(limit("bounded", directory, singleLine));

      expect(withLineBreaks).toContain("tail line");
      expect(withLineBreaks).not.toContain("\uFFFD");
      expect(withoutLineBreaks).toStartWith("🙂");
      expect(withoutLineBreaks).not.toContain("\uFFFD");
      expect(Buffer.byteLength(withoutLineBreaks)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    });
  });
});
