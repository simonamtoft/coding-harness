import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AZURE_EGRESS_HOSTS,
  BASE_EGRESS_HOSTS,
  egressDecision,
  GO_PROXY_EGRESS_HOSTS,
  isPublicAddress,
  providerHostRules,
  proxyEnvironment,
  startEgressProxy,
  type HostRule,
} from "./egress-proxy.ts";

const base = mkdtempSync(join(tmpdir(), "egress-proxy-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("egressDecision", () => {
  test.each([
    ["github.com:443"],
    ["github.com:22"],
    ["GitHub.com.:443"],
    ["objects.githubusercontent.com:443"],
    ["registry.npmjs.org:443"],
    ["repo1.maven.org:443"],
    ["crates.io:443"],
    ["api.nuget.org:443"],
    ["rubygems.org:443"],
  ])("allows %s", (authority) => {
    expect(egressDecision(authority, BASE_EGRESS_HOSTS).allowed).toBe(true);
  });

  test.each([
    ["example.com:443", "not-allowlisted"],
    ["api.osv.dev:443", "not-allowlisted"],
    ["static.crates.io:443", "not-allowlisted"],
    ["registry.npmjs.org:22", "not-allowlisted"],
    ["githubusercontent.com:443", "not-allowlisted"],
    ["evilgithub.com:443", "not-allowlisted"],
    ["github.com.evil.test:443", "not-allowlisted"],
    ["140.82.121.4:443", "ip-literal"],
    ["[::1]:443", "ip-literal"],
    ["github.com", "malformed"],
    ["github.com:0", "malformed"],
    ["git_hub.com:443", "malformed"],
  ])("refuses %s as %s", (authority, reason) => {
    expect(egressDecision(authority, BASE_EGRESS_HOSTS)).toEqual({ allowed: false, reason: reason as never });
  });

  test("Azure hosts are not in the base allowlist", () => {
    expect(egressDecision("management.azure.com:443", BASE_EGRESS_HOSTS).allowed).toBe(false);
    expect(egressDecision("management.azure.com:443", AZURE_EGRESS_HOSTS).allowed).toBe(true);
  });

  test("the Go module proxy is only a grant, never in the base allowlist", () => {
    expect(egressDecision("proxy.golang.org:443", BASE_EGRESS_HOSTS).allowed).toBe(false);
    expect(egressDecision("proxy.golang.org:443", GO_PROXY_EGRESS_HOSTS).allowed).toBe(true);
  });
});

describe("providerHostRules", () => {
  test("keeps HTTPS provider hosts and drops loopback, IP and plain HTTP endpoints", () => {
    expect(providerHostRules([
      "https://api.anthropic.com",
      "https://gateway.example.com:8443/v1",
      "https://api.anthropic.com/v1",
      "http://localhost:8080/v1",
      "http://127.0.0.1:11434",
      "https://10.0.0.5/v1",
      "http://insecure.example.com",
      undefined,
      "not a url",
    ])).toEqual([
      { host: "api.anthropic.com", ports: [443] },
      { host: "gateway.example.com", ports: [8443] },
    ]);
  });
});

describe("isPublicAddress", () => {
  test.each([
    ["140.82.121.4", true], ["2606:4700::1111", true],
    ["127.0.0.1", false], ["10.1.2.3", false], ["192.168.1.1", false], ["172.20.0.1", false],
    ["169.254.169.254", false], ["100.64.0.1", false], ["0.0.0.0", false],
    ["::1", false], ["::ffff:127.0.0.1", false], ["::ffff:7f00:1", false], ["fd00::1", false], ["fe80::1", false],
    ["198.18.0.1", false], ["192.0.2.1", false], ["203.0.113.9", false], ["2001:db8::1", false],
    ["64:ff9b::7f00:1", false], ["2002:7f00:1::1", false],
  ])("%s → %p", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe("proxyEnvironment", () => {
  test("carries the grant token as proxy credentials and routes Git over SSH through the proxy", () => {
    const env = proxyEnvironment(51234, "abc");
    expect(env.https_proxy).toBe("http://pi:abc@127.0.0.1:51234");
    expect(env.GIT_SSH_COMMAND).toContain("-x 127.0.0.1:51234");
  });
});

/** First byte of a TLS handshake record, enough for the proxy's protocol check. */
const TLS_HELLO = "\x16\x03\x01";

/** Sends a raw request to the proxy and returns the response status line and anything the upstream sent. */
async function request(path: string, head: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path });
    let response = "";
    socket.on("data", (chunk) => { response += chunk.toString("latin1"); });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
    socket.write(head);
  });
}

describe("startEgressProxy", () => {
  async function fixture(rules: readonly HostRule[], addresses = ["93.184.216.34"]) {
    const upstreamPath = join(base, `upstream-${Math.random().toString(36).slice(2)}.sock`);
    const proxyPath = join(base, `proxy-${Math.random().toString(36).slice(2)}.sock`);
    const connected: Array<{ address: string; port: number }> = [];
    const upstream = createServer((socket) => socket.once("data", () => socket.end("upstream-hello")));
    await new Promise<void>((resolve) => upstream.listen(upstreamPath, resolve));
    const proxy = await startEgressProxy({
      rules,
      listen: { path: proxyPath },
      resolve: async () => addresses,
      connectUpstream: (address, port) => {
        connected.push({ address, port });
        return connect({ path: upstreamPath });
      },
    });
    return {
      proxy, proxyPath, connected,
      async close() {
        await proxy.close();
        upstream.close();
      },
    };
  }

  test("tunnels an allowlisted host to its resolved address", async () => {
    const f = await fixture([{ host: "allowed.test", ports: [443] }]);
    try {
      const response = await request(f.proxyPath, `CONNECT allowed.test:443 HTTP/1.1\r\nHost: allowed.test:443\r\n\r\n${TLS_HELLO}`);
      expect(response).toStartWith("HTTP/1.1 200 Connection Established\r\n\r\n");
      expect(response).toEndWith("upstream-hello");
      expect(f.connected).toEqual([{ address: "93.184.216.34", port: 443 }]);
    } finally {
      await f.close();
    }
  });

  test.each([
    ["an unlisted host", "CONNECT example.com:443 HTTP/1.1\r\n\r\n"],
    ["an unlisted port", "CONNECT allowed.test:8443 HTTP/1.1\r\n\r\n"],
    ["an IP literal", "CONNECT 93.184.216.34:443 HTTP/1.1\r\n\r\n"],
    ["plain HTTP forwarding", "GET http://allowed.test/ HTTP/1.1\r\nHost: allowed.test\r\n\r\n"],
  ])("refuses %s without connecting upstream", async (_name, head) => {
    const f = await fixture([{ host: "allowed.test", ports: [443] }]);
    try {
      expect(await request(f.proxyPath, head)).toStartWith("HTTP/1.1 403 Forbidden");
      expect(f.connected).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test("refuses an allowlisted name that resolves to a local address", async () => {
    const f = await fixture([{ host: "allowed.test", ports: [443] }], ["93.184.216.34", "127.0.0.1"]);
    try {
      const response = await request(f.proxyPath, "CONNECT allowed.test:443 HTTP/1.1\r\n\r\n");
      expect(response).toStartWith("HTTP/1.1 403 Forbidden");
      expect(response).toContain("non-public address");
      expect(f.connected).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test("a grant token adds hosts for the command that carries it only", async () => {
    const f = await fixture([]);
    try {
      const token = f.proxy.grant([{ host: "granted.test", ports: [443] }]);
      const auth = (secret: string) => `Proxy-Authorization: Basic ${Buffer.from(`pi:${secret}`).toString("base64")}\r\n`;
      const head = (extra: string) => `CONNECT granted.test:443 HTTP/1.1\r\n${extra}\r\n${TLS_HELLO}`;
      expect(await request(f.proxyPath, head(auth(token)))).toStartWith("HTTP/1.1 200");
      expect(await request(f.proxyPath, head(""))).toStartWith("HTTP/1.1 403");
      expect(await request(f.proxyPath, head(auth("forged")))).toStartWith("HTTP/1.1 403");
      f.proxy.revoke(token);
      expect(await request(f.proxyPath, head(auth(token)))).toStartWith("HTTP/1.1 403");
    } finally {
      await f.close();
    }
  });

  test("revoking a grant closes tunnels opened with it", async () => {
    const f = await fixture([]);
    try {
      const token = f.proxy.grant([{ host: "granted.test", ports: [443] }]);
      const auth = `Proxy-Authorization: Basic ${Buffer.from(`pi:${token}`).toString("base64")}\r\n`;
      const socket = connect({ path: f.proxyPath });
      const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
      await new Promise<void>((resolve) => {
        socket.once("data", () => resolve());
        socket.write(`CONNECT granted.test:443 HTTP/1.1\r\n${auth}\r\n`);
      });
      f.proxy.revoke(token);
      await closed;
    } finally {
      await f.close();
    }
  });

  test("drops plaintext sent inside an HTTPS tunnel but relays SSH on port 22", async () => {
    const f = await fixture([{ host: "allowed.test", ports: [443, 22] }]);
    try {
      const http = await request(f.proxyPath, "CONNECT allowed.test:443 HTTP/1.1\r\n\r\nGET / HTTP/1.1\r\n\r\n");
      expect(http).toBe("HTTP/1.1 200 Connection Established\r\n\r\n");
      const ssh = await request(f.proxyPath, "CONNECT allowed.test:22 HTTP/1.1\r\n\r\nSSH-2.0-OpenSSH\r\n");
      expect(ssh).toEndWith("upstream-hello");
    } finally {
      await f.close();
    }
  });
});
