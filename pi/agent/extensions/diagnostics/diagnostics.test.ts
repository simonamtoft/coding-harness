import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatDiagnosticResult, resolveDiagnostics, runDiagnostics } from "./diagnostics.ts";

test("discovers an executable project diagnostics script", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-diagnostics-"));
  try {
    assert.equal(await resolveDiagnostics(cwd), undefined);

    const directory = join(cwd, ".agent");
    const script = join(directory, "diagnostics.sh");
    mkdirSync(directory);
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o700);

    assert.deepEqual(await resolveDiagnostics(cwd), {
      label: ".agent/diagnostics.sh",
      command: script,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runs an approved diagnostics snapshot for the path changed by an edit", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-diagnostics-run-"));
  try {
    const result = await runDiagnostics(
      Buffer.from("#!/bin/sh\nprintf 'checked:%s' \"$1\"\nexit 1\n"),
      "src/app.ts",
      cwd,
      undefined,
      30_000,
    );

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "checked:src/app.ts");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("terminates diagnostic descendants when the timeout expires", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-diagnostics-timeout-"));
  try {
    const started = Date.now();
    const result = await runDiagnostics(
      Buffer.from("#!/bin/sh\nsleep 60 &\nwait\n"),
      "src/app.ts",
      cwd,
      undefined,
      25,
    );

    assert.notEqual(result.code, 0);
    assert.ok(Date.now() - started < 1_000);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("formats passing and failing diagnostics as advisory feedback", () => {
  assert.match(
    formatDiagnosticResult({ stdout: "", stderr: "", code: 0, killed: false }),
    /^Fast diagnostics \(passed; advisory only\):\n\(no output\)$/,
  );
  assert.match(
    formatDiagnosticResult({ stdout: "issue", stderr: "details", code: 1, killed: false }),
    /^Fast diagnostics \(reported findings; advisory only\):\nissue\ndetails$/,
  );
});
