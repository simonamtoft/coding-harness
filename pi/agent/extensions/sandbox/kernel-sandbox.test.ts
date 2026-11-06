import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIVE_VARIABLE,
  commandSandboxMode,
  commandSandboxProfile,
  commandSandboxScope,
  confidentialSandboxProfile,
  confinedEnvironment,
  confinedShellCommand,
  DISABLE_VARIABLE,
  EGRESS_VARIABLE,
  homeToolchainRoots,
  LOCAL_SERVICE_PORTS,
  type CommandSandboxScope,
} from "./kernel-sandbox.ts";
import { proxyEnvironment, startEgressProxy } from "./egress-proxy.ts";

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
  mkdirSync(join(root, ".venv", "site-packages", "certifi"), { recursive: true });
  writeFileSync(join(root, ".venv", "site-packages", "certifi", "cacert.pem"), "public CA bundle");
  mkdirSync(join(root, ".aws", "certifi"), { recursive: true });
  writeFileSync(join(root, ".aws", "certifi", "cacert.pem"), "aws");
  mkdirSync(join(root, "fixtures"), { recursive: true });
  writeFileSync(join(root, "fixtures", "cacert.pem"), "private");
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
    egressProxyPort: undefined,
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
      egressProxyPort: undefined,
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
      secretScanRoots: [], sessionDirectory: undefined, egressProxyPort: undefined,
    });
    expect(profile).toContain('(subpath "/h/a\\"b\\\\c")');
  });
});

function networkOnlyScope(egressProxyPort: number | undefined): CommandSandboxScope {
  return {
    home: "/h", unreadableRoots: [], readable: [], writable: [], unreadable: [], unwritable: [],
    readableExceptions: [], unwritableLiterals: [], gitCommonDirectory: undefined,
    secretScanRoots: [], sessionDirectory: undefined, egressProxyPort,
  };
}

describe("network rules", () => {
  test("open egress denies localhost except the local service ports", () => {
    const profile = commandSandboxProfile(networkOnlyScope(undefined));
    expect(profile).toContain('(deny network-outbound\n  (remote ip "localhost:*")');
    expect(profile).not.toContain('"*:*"');
    for (const port of LOCAL_SERVICE_PORTS) expect(profile).toContain(`(remote ip "localhost:${port}")`);
    expect(profile.indexOf("(deny network-outbound")).toBeLessThan(profile.indexOf("(allow network-outbound"));
  });

  test("proxied egress denies every outbound IP connection except the proxy and local service ports", () => {
    const profile = commandSandboxProfile(networkOnlyScope(51234));
    expect(profile).toContain('(deny network-outbound\n  (remote ip "*:*")');
    expect(profile).toContain('(remote ip "localhost:51234")');
    expect(profile.indexOf('"*:*"')).toBeLessThan(profile.indexOf('"localhost:51234"'));
  });

  // Inside a confined process a valid profile fails only at sandbox_apply, so this also runs in Pi sessions.
  test.skipIf(process.platform !== "darwin").each([undefined, 51234])("Seatbelt compiles the profile (proxy port %p)", (port) => {
    const result = spawnSync("/usr/bin/sandbox-exec", ["-p", commandSandboxProfile(networkOnlyScope(port)), "/usr/bin/true"], {
      encoding: "utf8",
    });
    expect(result.status === 0 || result.stderr.includes("sandbox_apply")).toBe(true);
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
      "open",
    );
    expect(env).toEqual({
      PATH: "/bin", HOME: "/h", TMPDIR: "/tmp/session/", [ACTIVE_VARIABLE]: "1", [EGRESS_VARIABLE]: "open",
    });
  });

  test("points proxied commands at the egress proxy, overriding inherited proxy settings", () => {
    const env = confinedEnvironment(
      { HTTPS_PROXY: "http://corp:8080", NO_PROXY: "*" }, undefined, "proxied", proxyEnvironment(51234),
    );
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:51234");
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1");
    expect(env.NODE_USE_ENV_PROXY).toBe("1");
  });
});

describe("commandSandboxMode", () => {
  test("does not nest inside an already confined command, and keeps its egress policy", () => {
    expect(commandSandboxMode({ [ACTIVE_VARIABLE]: "1", [EGRESS_VARIABLE]: "proxied" }, "darwin", () => true))
      .toEqual({ kind: "unconfined", reason: "already-confined", inheritedEgress: "proxied" });
  });

  test("treats an inherited profile without a proxied marker as open egress", () => {
    for (const marker of [undefined, "open", "bogus"]) {
      expect(commandSandboxMode({ [ACTIVE_VARIABLE]: "1", [EGRESS_VARIABLE]: marker }, "darwin", () => true))
        .toEqual({ kind: "unconfined", reason: "already-confined", inheritedEgress: "open" });
    }
  });

  test("keeps the local-model egress of a confidential-mode launcher", () => {
    expect(commandSandboxMode({ [ACTIVE_VARIABLE]: "1", [EGRESS_VARIABLE]: "local-model" }, "darwin", () => true))
      .toEqual({ kind: "unconfined", reason: "already-confined", inheritedEgress: "local-model" });
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

describe("confidentialSandboxProfile", () => {
  const profile = confidentialSandboxProfile({
    root: "/Users/u/project", home: "/Users/u", agentDirectory: "/Users/u/.pi/agent",
    systemTempDirectory: "/private/var/folders/x/T", modelPort: 8080,
  });

  test("denies every outbound connection except the model port", () => {
    expect(profile).toContain("(deny network-outbound)\n");
    expect(profile.match(/\(remote ip /g)).toEqual(['(remote ip ']);
    expect(profile).toContain('(allow network-outbound\n  (remote ip "localhost:8080")');
    expect(profile.indexOf("(deny network-outbound)")).toBeLessThan(profile.indexOf("(allow network-outbound"));
  });

  test("denies LaunchServices, Apple Events, DNS and URL sessions", () => {
    for (const service of [
      "com.apple.coreservices.launchservicesd", "com.apple.coreservices.appleevents", "com.apple.dnssd.service",
      "com.apple.nsurlsessiond",
    ]) {
      expect(profile).toContain(service);
    }
  });

  test.skipIf(process.platform !== "darwin")("Seatbelt compiles the profile", () => {
    const result = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/usr/bin/true"], { encoding: "utf8" });
    expect(result.status === 0 || result.stderr.includes("sandbox_apply")).toBe(true);
  });
});

// Inside a confined command macOS rejects applying the test profile, so these run only from an unconfined shell.
describe.skipIf(process.platform !== "darwin" || process.env[ACTIVE_VARIABLE] === "1")("confined commands on macOS", () => {
  const f = fixture();

  test("read and write inside the checkout and session directory", () => {
    const result = runConfined(
      `cat inside.txt && echo ok > new.txt && echo tmp > "${f.sessionTempDirectory}/scratch" && git status --short`
        + ` && echo tmp > "${base}/system-temp/scratch" && cat "${f.home}/.cache/cert.pem" && cat app/.env.example`
        + " && cat .venv/site-packages/certifi/cacert.pem",
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
    ["a CA bundle name inside a credential directory", () => "cat .aws/certifi/cacert.pem"],
    ["a bundle name moved under certifi by renaming its parent", () => "mv fixtures certifi; cat certifi/cacert.pem"],
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
    ["the certifi CA bundle", () => "echo x >> .venv/site-packages/certifi/cacert.pem"],
    ["a key renamed to the certifi bundle name", () => "mkdir -p certifi && mv key.pem certifi/cacert.pem"],
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

  test("proxied profile denies direct external connections but reaches the proxy and local service ports", async () => {
    const servers: ReturnType<typeof createServer>[] = [];
    const listen = async (port: number) => {
      const server = createServer((socket) => socket.end("hello"));
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      servers.push(server);
      return (server.address() as { port: number }).port;
    };
    const proxyPort = await listen(0);
    let servicePort: number | undefined;
    for (const port of LOCAL_SERVICE_PORTS) {
      servicePort = await listen(port).catch(() => undefined);
      if (servicePort) break;
    }
    const profile = commandSandboxProfile(networkOnlyScope(proxyPort));
    const connectTo = (host: string, port: number) =>
      runConfined(`python3 -c 'import socket; socket.create_connection(("${host}", ${port}), timeout=3)'`, f.root, profile);
    try {
      const direct = connectTo("1.1.1.1", 443);
      expect(direct.status).not.toBe(0);
      expect(direct.output).toContain("PermissionError");
      expect(connectTo("127.0.0.1", proxyPort).status).toBe(0);
      if (servicePort) expect(connectTo("127.0.0.1", servicePort).status).toBe(0);
    } finally {
      for (const server of servers) server.close();
    }
  });

  // The tunnel to the allowlisted host opens (CONNECT 200); the plaintext request inside it is then dropped.
  test("curl through the egress proxy reaches allowlisted hosts and is refused others", async () => {
    const upstream = createServer((socket) => socket.end("HTTP/1.1 204 No Content\r\n\r\n"));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;
    const proxy = await startEgressProxy({
      rules: [{ host: "allowed.test", ports: [443] }],
      resolve: async () => ["93.184.216.34"],
      connectUpstream: () => connect({ host: "127.0.0.1", port: upstreamPort }),
    });
    const profile = commandSandboxProfile(networkOnlyScope(proxy.port));
    // Asynchronous, because the proxy runs on this process's event loop, which spawnSync would block.
    const curl = (host: string) => new Promise<string>((resolve) => {
      const command = `curl -s -o /dev/null -w '%{http_connect} %{http_code}' -p -x http://127.0.0.1:${proxy.port} http://${host}:443/`;
      const child = spawn("/bin/bash", ["-c", confinedShellCommand(command, profile)], { cwd: f.root });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.on("close", () => resolve(output));
    });
    try {
      expect(await curl("allowed.test")).toStartWith("200 ");
      expect(await curl("allowed.test")).not.toBe("200 204");
      expect(await curl("example.com")).toStartWith("403");
    } finally {
      await proxy.close();
      upstream.close();
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
      egressProxyPort: undefined,
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

describe.skipIf(process.platform !== "darwin" || process.env[ACTIVE_VARIABLE] === "1")("confidential mode on macOS", () => {
  const f = fixture();

  async function withProfile(run: (profile: string, modelPort: number, otherPort: number) => void) {
    const servers = [0, 0].map(() => createServer((socket) => socket.end("hello")));
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))));
    const [modelPort, otherPort] = servers.map((server) => (server.address() as { port: number }).port);
    const profile = confidentialSandboxProfile({
      root: f.root, home: f.home, agentDirectory: f.agentDirectory, systemTempDirectory: join(base, "system-temp"), modelPort,
    });
    try {
      run(profile, modelPort, otherPort);
    } finally {
      for (const server of servers) server.close();
    }
  }

  const connectTo = (profile: string, host: string, port: number) =>
    runConfined(`python3 -c 'import socket; socket.create_connection(("${host}", ${port}), timeout=3)'`, f.root, profile);

  test("reaches the model port and nothing else", async () => {
    await withProfile((profile, modelPort, otherPort) => {
      expect(connectTo(profile, "127.0.0.1", modelPort).status).toBe(0);
      for (const [host, port] of [["127.0.0.1", otherPort], ["127.0.0.1", 6767], ["1.1.1.1", 443]] as const) {
        const result = connectTo(profile, host, port);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain("PermissionError");
      }
    });
  });

  test("cannot resolve names", async () => {
    await withProfile((profile) => {
      const result = runConfined(`python3 -c 'import socket; socket.getaddrinfo("example.com", 443)'`, f.root, profile);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("gaierror");
    });
  });

  test("writes only to the checkout, temp directories and Pi sessions", async () => {
    mkdirSync(join(f.agentDirectory, "sessions"), { recursive: true });
    await withProfile((profile) => {
      const allowed = `echo ok > new.txt && echo s > "${f.agentDirectory}/sessions/s.jsonl" && echo t > "${base}/system-temp/t"`
        + ` && mkdir "${f.agentDirectory}/trust.json.lock" && touch "${f.agentDirectory}/trust.json.lock"`
        + ` && rmdir "${f.agentDirectory}/trust.json.lock" && echo [] > "${f.agentDirectory}/crashes.json"`
        + ` && echo {} > "${f.agentDirectory}/consumption.json.42.tmp"`
        + ` && mv "${f.agentDirectory}/consumption.json.42.tmp" "${f.agentDirectory}/consumption.json"`;
      expect(runConfined(allowed, f.root, profile).status).toBe(0);
      for (const command of [
        `mkdir -p "${f.home}/Library/Mobile Documents" && echo x > "${f.home}/Library/Mobile Documents/copy.txt"`,
        `echo x > "${f.sibling}/copy.txt"`,
        `echo x > "${f.agentDirectory}/settings.json"`,
        `echo x > "${f.agentDirectory}/trust.json"`,
        `mkdir "${f.agentDirectory}/trust.json.lock.d"`,
        `echo x > "${f.agentDirectory}/consumption.json.tmp.sh"`,
        "echo x > .git/hooks/pre-commit",
        "echo x >> .git/config",
      ]) {
        const result = runConfined(command, f.root, profile);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain("Operation not permitted");
      }
    });
  });
});
