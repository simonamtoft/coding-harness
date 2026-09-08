import { closeSync, fchmodSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
export const MAX_CONTEXT_BYTES = 16 * 1024;

export type TailTruncator = (output: string, options: { maxBytes: number; maxLines: number }) => { content: string };

export type LimitedBashOutput = {
  content: Array<{ type: "text"; text: string }>;
  path: string;
  totalBytes: number;
};

function artifactPath(sessionTempDirectory: string): string {
  return join(sessionTempDirectory, `bash-output-${randomUUID()}.txt`);
}

function persistOutput(sessionTempDirectory: string, output: string | Buffer): string {
  const path = artifactPath(sessionTempDirectory);
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(path, "wx", 0o600);
    fchmodSync(fileDescriptor, 0o600);
    writeFileSync(fileDescriptor, output, "utf8");
    return path;
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

function marker(totalBytes: number, path: string): string {
  return `[Bash output truncated: ${totalBytes} bytes; full output: ${path}]`;
}

export function limitBashOutput(
  output: string,
  sessionTempDirectory: string | undefined,
  truncateTail: TailTruncator,
  fullOutputPath?: string,
): LimitedBashOutput | undefined {
  const completeOutput = fullOutputPath ? readFileSync(fullOutputPath) : Buffer.from(output);
  const totalBytes = completeOutput.byteLength;
  if (totalBytes <= MAX_CONTEXT_BYTES || !sessionTempDirectory) return undefined;

  const path = persistOutput(sessionTempDirectory, completeOutput);
  const truncationMarker = marker(totalBytes, path);
  const separator = "\n\n";
  const tail = truncateTail(completeOutput.toString("utf8"), {
    maxBytes: Math.max(0, MAX_CONTEXT_BYTES - Buffer.byteLength(separator + truncationMarker)),
    maxLines: Number.MAX_SAFE_INTEGER,
  });

  return {
    content: [{ type: "text", text: `${tail.content}${separator}${truncationMarker}` }],
    path,
    totalBytes,
  };
}

export function limitBashResultContent(
  content: readonly unknown[],
  sessionTempDirectory: string | undefined,
  truncateTail: TailTruncator,
  fullOutputPath?: string,
): { content: Array<{ type: "text"; text: string }> } | undefined {
  const output = content.map((block) => {
    if (!block || typeof block !== "object" || !("type" in block) || block.type !== "text" || !("text" in block)) return "";
    return typeof block.text === "string" ? block.text : "";
  }).join("");
  const limited = limitBashOutput(output, sessionTempDirectory, truncateTail, fullOutputPath);
  return limited === undefined ? undefined : { content: limited.content };
}
