import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_VARIABLE,
  commandSandboxMode,
  commandSandboxProfile,
  commandSandboxScope,
  confinedEnvironment,
  confinedShellCommand,
  DISABLE_VARIABLE,
  homeToolchainRoots,
} from "./kernel-sandbox.ts";

const base = realpathSync.native(mkdtempSync(join(tmpdir(), "kernel-sandbox-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

function fixture() {
  const home = join(base, `home-${Math.random().toString(36).slice(2)}`);
  const root = join(home, "project");
  const sibling = join(home, "sibling");
  const agentDirectory = join(home, ".pi", "agent");
  const sessionTempParent = join(base, `sessions-${Math.random().toString(36).slice(2)}`);
  const sessionTempDirectory = join(sessionTempParent, "current");
  const otherSession = join(sessionTempParent, "other");
  for (const dir of [root, sibling, agentDirectory, join(home, ".ssh"), sessionTempDirectory, otherSession]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(root, "inside.txt"), "inside");
  writeFileSync(join(root, ".env"), "SECRET=1");
  writeFileSync(join(sibling, "notes.txt"), "sibling");
  writeFileSync(join(agentDirectory, "auth.json"), "{}");
  writeFileSync(join(home, ".ssh", "id_ed25519"), "key");
  writeFileSync(join(otherSession, "report.html"), "other");
  mkdirSync(join(home, ".cache"), { recursive: true });
  writeFileSync(join(home, ".cache", "cert.pem"), "certificate bundle");
  mkdirSync(join(base, "system-temp"), { recursive: true });
  mkdirSync(join(root, ".aws"), { recursive: true });
  writeFileSync(join(root, ".aws", "credentials"), "aws");
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "app", ".env.example"), "TEMPLATE=1");
  writeFileSync(join(root, "key.pem"), "pem");
  spawnSync("git", ["init", "-q", root]);
  spawnSync("git", ["-C", root, "add", "app/.env.example"]);
  const scope = commandSandboxScope({
    root,
    home,
    agentDirectory,
    sessionTempDirectory,
    sessionTempParent,
    systemTempDirectory: join(base, "system-temp"),
    codingHarnessRoot: join(home, "coding-harness"),
    researchVaultRoot: join(home, "research"),
  });
  return { home, root, sibling, agentDirectory, sessionTempDirectory, otherSession, profile: commandSandboxProfile(scope) };
}

function runConfined(command: string, cwd: string, profile: string) {
  const result = spawnSync("/bin/bash", ["-c", confinedShellCommand(command, profile)], { cwd, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("commandSandboxProfile", () => {
  test("denies home reads before allowing roots, and applies exceptions last", () => {
    const profile = commandSandboxProfile({
      home: "/Users/u",
      unreadableRoots: ["/Users/u"],
      readable: ["/Users/u/project"],
      writable: ["/Users/u/project"],
      unreadable: ["/Users/u/project/secret"],
      unwritable: ["/Users/u/project/.git/hooks"],
      readableExceptions: [],
      unwritableLiterals: [],
      gitCommonDirectory: undefined,
      secretScanRoots: [],
      sessionDirectory: undefined,
    });
    const order = ['(deny file-read-data\n  (subpath "/Users/u")', '(allow file-read-data\n  (subpath "/Users/u/project")',
      '(subpath "/Users/u/project/secret")', '(deny file-write*\n  (subpath "/")', '(allow file-write*',
      '(subpath "/Users/u/project/.git/hooks")'].map((part) => profile.indexOf(part));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("escapes quotes and backslashes in paths", () => {
    const profile = commandSandboxProfile({
      home: "/h", unreadableRoots: ['/h/a"b\\c'], readable: [], writable: [], unreadable: [], unwritable: [],
      readableExceptions: [], unwritableLiterals: [], gitCommonDirectory: undefined,
      secretScanRoots: [], sessionDirectory: undefined,
    });
    expect(profile).toContain('(subpath "/h/a\\"b\\\\c")');
  });
});

describe("homeToolchainRoots", () => {
  test("allows toolchain prefixes under home but never the home itself or Pi's agent directory", () => {
    const home = join(base, "toolchain-home");
    const agentDirectory = join(home, ".pi", "agent");
    for (const bin of [".volta/bin", ".pi/agent/bin", "bin", ".pi/bin"]) mkdirSync(join(home, bin), { recursive: true });
    const path = [".volta/bin", ".pi/agent/bin", "bin", ".pi/bin"].map((bin) => join(home, bin)).join(":");
    expect(homeToolchainRoots(home, agentDirectory, `${path}:/usr/bin`)).toEqual([join(home, ".volta")]);
  });
});

describe("confinedEnvironment", () => {
  test("removes credential variables, marks confinement and points TMPDIR at the session directory", () => {
    const env = confinedEnvironment(
      {
        PATH: "/bin", IM_GPT_API_KEY: "k", NETLIFY_AUTH_TOKEN: "t", DB_PASSWORD: "p", CLIENT_SECRET: "s", HOME: "/h",
        AWS_SECRET_ACCESS_KEY: "a", AZURE_OPENAI_KEY: "z", GITHUB_PAT: "g", NPM_CONFIG__AUTH: "n",
        BASH_ENV: "/h/project/startup.sh", ENV: "/h/x", "BASH_FUNC_exec%%": "() { :; }",
      },
      "/tmp/session",
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", TMPDIR: "/tmp/session/", [ACTIVE_VARIABLE]: "1" });
  });
});

describe("commandSandboxMode", () => {
  test("does not nest inside an already confined command", () => {
    expect(commandSandboxMode({ [ACTIVE_VARIABLE]: "1" }, "darwin", () => true))
      .toEqual({ kind: "unconfined", reason: "already-confined" });
  });

  test("ignores a forged confinement marker in an unconfined process", () => {
    expect(commandSandboxMode({ [ACTIVE_VARIABLE]: "1" }, "darwin", () => false)).toEqual({ kind: "confine" });
  });

  test("honours the explicit off switch", () => {
    expect(commandSandboxMode({ [DISABLE_VARIABLE]: "off" }, "darwin")).toEqual({ kind: "unconfined", reason: "disabled" });
  });

  test("leaves non-macOS hosts to their own boundary", () => {
    expect(commandSandboxMode({}, "linux")).toEqual({ kind: "unconfined", reason: "unsupported-platform" });
  });
});

// Inside a confined command macOS rejects applying the test profile, so these run only from an unconfined shell.
describe.skipIf(process.platform !== "darwin" || process.env[ACTIVE_VARIABLE] === "1")("confined commands on macOS", () => {
  const f = fixture();

  test("read and write inside the checkout and session directory", () => {
    const result = runConfined(
      `cat inside.txt && echo ok > new.txt && echo tmp > "${f.sessionTempDirectory}/scratch" && git status --short`
        + ` && echo tmp > "${base}/system-temp/scratch" && cat "${f.home}/.cache/cert.pem" && cat app/.env.example`,
      f.root, f.profile,
    );
    expect(result.status).toBe(0);
  });

  test.each([
    ["a sibling project", (x: typeof f) => `cat "${x.sibling}/notes.txt"`],
    ["Pi credentials", (x: typeof f) => `cat "${x.agentDirectory}/auth.json"`],
    ["an SSH private key", (x: typeof f) => `cat "${x.home}/.ssh/id_ed25519"`],
    ["a dot-env file inside the checkout", () => "cat .env"],
    ["a credential directory inside the checkout", () => "cat .aws/credentials"],
    ["a secret renamed to an ordinary name", () => "mv key.pem notes.txt; cat notes.txt"],
    ["another session's temp directory", (x: typeof f) => `cat "${x.otherSession}/report.html"`],
    ["a file through a python subprocess", (x: typeof f) => `python3 -c 'open("${x.sibling}/notes.txt").read()'`],
  ])("denies reading %s", (_name, command) => {
    const result = runConfined(command(f), f.root, f.profile);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/Operation not permitted|PermissionError/);
  });

  test.each([
    ["a shell startup file", (x: typeof f) => `echo x >> "${x.home}/.zshrc"`],
    ["another session's temp directory", (x: typeof f) => `echo x > "${x.otherSession}/report.html"`],
    ["the Git hooks directory", () => "echo x > .git/hooks/pre-commit"],
    ["the Git config", () => "echo x >> .git/config"],
    ["a Git commondir redirect", () => "echo /private/tmp > .git/commondir"],
    ["a replacement .git", () => "mv .git .git-old"],
    ["the system temp directory itself", () => `mv "${base}/system-temp" "${base}/moved"`],
  ])("denies writing %s", (_name, command) => {
    const result = runConfined(command(f), f.root, f.profile);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Operation not permitted");
  });

  test("denies connections to localhost services", async () => {
    const server = createServer((socket) => socket.end("hello"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    try {
      const result = runConfined(
        `python3 -c 'import socket; socket.create_connection(("127.0.0.1", ${port}), timeout=2)'`,
        f.root, f.profile,
      );
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("PermissionError");
    } finally {
      server.close();
    }
  });

  test("opens an approved root for that command only", () => {
    const grantedRoot = join(f.home, "granted");
    mkdirSync(grantedRoot, { recursive: true });
    writeFileSync(join(grantedRoot, "profile.json"), "{}");
    const scope = (approvedRoots: string[]) => commandSandboxProfile(commandSandboxScope({
      root: f.root, home: f.home, agentDirectory: f.agentDirectory,
      sessionTempDirectory: f.sessionTempDirectory, sessionTempParent: join(f.sessionTempDirectory, ".."),
      systemTempDirectory: join(base, "system-temp"),
      codingHarnessRoot: join(f.home, "coding-harness"), researchVaultRoot: join(f.home, "research"), approvedRoots,
    }));
    const command = `cat "${grantedRoot}/profile.json" && echo token > "${grantedRoot}/cache"`;
    expect(runConfined(command, f.root, scope([grantedRoot])).status).toBe(0);
    expect(runConfined(command, f.root, scope([])).output).toContain("Operation not permitted");
  });

  test("rejects an invalid profile instead of running the command", () => {
    const result = runConfined("echo ran", f.root, "(version 1)\n(allow nonsense)");
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain("ran");
  });

  test("cannot apply a different profile inside a confined command, which is why confined Pi skips re-wrapping", () => {
    const inner = confinedShellCommand("echo nested", `${f.profile}(deny file-read-data (literal "/nonexistent"))\n`);
    const result = runConfined(inner, f.root, f.profile);
    expect(result.output).toContain("sandbox_apply");
    expect(result.output).not.toContain("nested");
  });
});
