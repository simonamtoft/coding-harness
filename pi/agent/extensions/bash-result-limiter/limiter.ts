import { closeSync, fchmodSync, openSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export const MAX_CONTEXT_BYTES = 16 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;
const SEPARATOR = "\n\n";
const NEWLINE = 0x0a;
const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION_BYTE = 0b1000_0000;

function artifactPath(sessionTempDirectory: string): string {
  return join(sessionTempDirectory, `bash-output-${randomUUID()}.txt`);
}

/** Creates a private artifact and hands its descriptor to `write`; removes the file if writing fails. */
function persistOutput(sessionTempDirectory: string, write: (fileDescriptor: number) => void): string {
  const path = artifactPath(sessionTempDirectory);
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(path, "wx", 0o600);
    fchmodSync(fileDescriptor, 0o600);
    write(fileDescriptor);
    return path;
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

function copyFileInto(fileDescriptor: number, sourcePath: string): void {
  const source = openSync(sourcePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    for (let read = readSync(source, buffer, 0, buffer.length, null); read > 0; read = readSync(source, buffer, 0, buffer.length, null)) {
      writeSync(fileDescriptor, buffer, 0, read);
    }
  } finally {
    closeSync(source);
  }
}

function readWindow(path: string, position: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  const source = openSync(path, "r");
  try {
    let filled = 0;
    while (filled < length) {
      const read = readSync(source, buffer, filled, length - filled, position + filled);
      if (read === 0) break;
      filled += read;
    }
    return buffer.subarray(0, filled);
  } finally {
    closeSync(source);
  }
}

/**
 * Decodes a window taken from the end of longer output. The window always opens mid-stream, so it is
 * advanced past any leading UTF-8 continuation bytes and past the partial first line; a window
 * holding no line break is decoded from its first character boundary instead of being emptied.
 */
function decodeTail(window: Buffer): string {
  let start = 0;
  while (start < window.length && (window[start]! & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_BYTE) start += 1;

  const newline = window.indexOf(NEWLINE, start);
  const lineStart = newline === -1 || newline + 1 >= window.length ? start : newline + 1;
  return window.subarray(lineStart).toString("utf8");
}

function marker(totalBytes: number, path: string): string {
  return `[Bash output truncated: ${totalBytes} bytes; full output: ${path}]`;
}

function textOf(content: readonly unknown[]): string {
  return content.map((block) => {
    if (!block || typeof block !== "object" || !("type" in block) || block.type !== "text" || !("text" in block)) return "";
    return typeof block.text === "string" ? block.text : "";
  }).join("");
}

/**
 * Replaces an oversized bash result with its tail plus a pointer to a private full-output artifact.
 * Returns undefined when the output already fits or no session directory is available, leaving Pi's
 * own bounded result in place.
 *
 * `fullOutputPath` is Pi's spilled-output file, written to the shared temp directory with default
 * permissions. Its contents are copied into a mode-0600 artifact rather than referenced, and are
 * never held in memory in full: the copy streams and only the retained tail is read back. The
 * returned `fullOutputPath` is that artifact, so callers can point result metadata at it too.
 */
export function limitBashResultContent(
  content: readonly unknown[],
  sessionTempDirectory: string | undefined,
  fullOutputPath?: string,
): { content: Array<{ type: "text"; text: string }>; fullOutputPath: string } | undefined {
  const output = fullOutputPath ? undefined : Buffer.from(textOf(content));
  const totalBytes = output ? output.byteLength : statSync(fullOutputPath!).size;
  if (totalBytes <= MAX_CONTEXT_BYTES || !sessionTempDirectory) return undefined;

  const path = persistOutput(sessionTempDirectory, (fileDescriptor) => {
    if (output) writeSync(fileDescriptor, output);
    else copyFileInto(fileDescriptor, fullOutputPath!);
  });
  const truncationMarker = marker(totalBytes, path);
  const retainedBytes = Math.max(0, MAX_CONTEXT_BYTES - Buffer.byteLength(SEPARATOR + truncationMarker));
  const window = output
    ? output.subarray(totalBytes - retainedBytes)
    : readWindow(fullOutputPath!, totalBytes - retainedBytes, retainedBytes);

  return { content: [{ type: "text", text: `${decodeTail(window)}${SEPARATOR}${truncationMarker}` }], fullOutputPath: path };
}
