import assert from "node:assert/strict";
import test from "node:test";
import { changesDirectoryToSessionTemp } from "./session-temp.ts";

const sessionTempDirectory = "/private/var/folders/example/T/pi-agent-501/session";
const resolvePath = (path: string) => path;

test("session-temp directory guard separates newline-delimited commands", () => {
  assert.equal(
    changesDirectoryToSessionTemp("cd scripts\nprintf '%s\\n' \"$PI_SESSION_TMPDIR\"", sessionTempDirectory, resolvePath),
    false,
  );
});

test("session-temp directory guard still blocks cd in a newline-delimited command", () => {
  assert.equal(
    changesDirectoryToSessionTemp("cd \"$PI_SESSION_TMPDIR\"\nprintf done", sessionTempDirectory, resolvePath),
    true,
  );
});

test("session-temp directory guard retains escaped-newline cd operands", () => {
  assert.equal(
    changesDirectoryToSessionTemp("cd \\\n\"$PI_SESSION_TMPDIR\"\nprintf done", sessionTempDirectory, resolvePath),
    true,
  );
});
