import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, connect, createServer, isIP, type ListenOptions, type Socket } from "node:net";

/**
 * HTTP CONNECT proxy that model commands are forced through: the command's Seatbelt profile allows outbound
 * connections only to this proxy's loopback port, because Seatbelt cannot filter by hostname. It runs inside the
 * unconfined Pi process and opens a tunnel only to an allowlisted hostname and port.
 */

/** `host` is an exact hostname, or `*.example.com` for any subdomain (not the bare domain). */
export interface HostRule {
  host: string;
  ports: readonly number[];
}

const HTTPS = [443];

export const BASE_EGRESS_HOSTS: readonly HostRule[] = [
  { host: "registry.npmjs.org", ports: HTTPS },
  { host: "pypi.org", ports: HTTPS },
  { host: "files.pythonhosted.org", ports: HTTPS },
  { host: "github.com", ports: [443, 22] },
  { host: "api.github.com", ports: HTTPS },
  { host: "codeload.github.com", ports: HTTPS },
  // Raw files, release assets and uv's Python downloads.
  { host: "*.githubusercontent.com", ports: HTTPS },
];

/** Added only for a command approved to use the Azure CLI credentials (SBX-38): `az` and Terraform. */
export const AZURE_EGRESS_HOSTS: readonly HostRule[] = [
  { host: "login.microsoftonline.com", ports: HTTPS },
  { host: "management.azure.com", ports: HTTPS },
  { host: "graph.microsoft.com", ports: HTTPS },
  // Terraform state backends and the az extension index; any storage account matches.
  { host: "*.blob.core.windows.net", ports: HTTPS },
  { host: "registry.terraform.io", ports: HTTPS },
  { host: "releases.hashicorp.com", ports: HTTPS },
  { host: "checkpoint-api.hashicorp.com", ports: HTTPS },
];

/** HTTPS hosts of model provider base URLs; loopback endpoints are excluded because the proxy refuses them anyway. */
export function providerHostRules(baseUrls: readonly (string | undefined)[]): HostRule[] {
  const rules = new Map<string, HostRule>();
  for (const baseUrl of baseUrls) {
    if (!URL.canParse(baseUrl ?? "")) continue;
    const url = new URL(baseUrl!);
    const host = normalizeHost(url.hostname);
    if (url.protocol !== "https:" || !host || host === "localhost") continue;
    const port = url.port ? Number(url.port) : 443;
    rules.set(`${host}:${port}`, { host, ports: [port] });
  }
  return [...rules.values()];
}

/** Lowercased hostname without a trailing dot, or undefined for IP literals and invalid names. */
function normalizeHost(host: string): string | undefined {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (isIP(name.replace(/^\[|\]$/g, "")) !== 0) return undefined;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(name) ? name : undefined;
}

function matchesRule(host: string, port: number, rule: HostRule): boolean {
  if (!rule.ports.includes(port)) return false;
  return rule.host.startsWith("*.") ? host.endsWith(rule.host.slice(1)) : host === rule.host;
}

export type EgressRefusal = "malformed" | "ip-literal" | "not-allowlisted";

/** Decides a CONNECT authority such as `github.com:443` against the rules, before any DNS lookup. */
export function egressDecision(
  authority: string,
  rules: readonly HostRule[],
): { allowed: true; host: string; port: number } | { allowed: false; reason: EgressRefusal } {
  const match = /^(\[[^\]]*\]|[^:]+):(\d{1,5})$/.exec(authority);
  const port = Number(match?.[2]);
  if (!match || port < 1 || port > 65535) return { allowed: false, reason: "malformed" };
  if (isIP(match[1].replace(/^\[|\]$/g, "")) !== 0) return { allowed: false, reason: "ip-literal" };
  const host = normalizeHost(match[1]);
  if (!host) return { allowed: false, reason: "malformed" };
  if (!rules.some((rule) => matchesRule(host, port, rule))) return { allowed: false, reason: "not-allowlisted" };
  return { allowed: true, host, port };
}

/**
 * IANA special-purpose ranges: loopback, private, link-local, carrier-grade NAT, benchmarking, documentation,
 * multicast and reserved, plus IPv6 translation prefixes (NAT64, 6to4, Teredo) that can embed any IPv4 address.
 */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv6");
/** Kept apart because BlockList matches IPv4 addresses against IPv6 rules in mapped form, so this would block all IPv4. */
const IPV4_MAPPED = new BlockList();
IPV4_MAPPED.addSubnet("::ffff:0:0", 96, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC.check(address, "ipv4");
  return family === 6 && !NON_PUBLIC.check(address, "ipv6") && !IPV4_MAPPED.check(address, "ipv6");
}

export interface EgressProxy {
  readonly port: number;
  /** Registers extra hosts for one command and returns the token its proxy URL carries. */
  grant(hosts: readonly HostRule[]): string;
  /** Ends a grant when its command finishes and closes the tunnels opened with it. */
  revoke(token: string): void;
  close(): Promise<void>;
}

export interface EgressProxyOptions {
  rules: readonly HostRule[];
  /** Defaults to an ephemeral loopback port. */
  listen?: ListenOptions;
  resolve?: (host: string) => Promise<string[]>;
  connectUpstream?: (address: string, port: number) => Socket;
}

const MAX_REQUEST_HEAD = 8192;
/** First byte of a TLS record carrying a handshake; plaintext HTTP inside a port-443 tunnel is refused. */
const TLS_HANDSHAKE_RECORD = 0x16;
const SSH_PORT = 22;
const REQUEST_HEAD_TIMEOUT_MS = 10_000;
/** The proxy URL's user name; the password is the grant token. */
const PROXY_USER = "pi";

async function systemResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
}

function grantToken(headers: string[]): string | undefined {
  const header = headers.find((line) => /^proxy-authorization:/i.test(line));
  const encoded = /^proxy-authorization:\s*basic\s+(\S+)/i.exec(header ?? "")?.[1];
  if (!encoded) return undefined;
  const credentials = Buffer.from(encoded, "base64").toString("utf8");
  return credentials.startsWith(`${PROXY_USER}:`) ? credentials.slice(PROXY_USER.length + 1) : undefined;
}

function refuse(client: Socket, status: string, reason: string): void {
  const body = `Pi command sandbox: ${reason}\n`;
  client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

const REFUSAL_MESSAGES: Record<EgressRefusal, string> = {
  malformed: "malformed CONNECT target",
  "ip-literal": "IP address targets are not allowed; connect by hostname",
  "not-allowlisted": "host and port are not on the command egress allowlist",
};

export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  const resolve = options.resolve ?? systemResolve;
  const connectUpstream = options.connectUpstream ?? ((address, port) => connect({ host: address, port }));
  const grants = new Map<string, { hosts: readonly HostRule[]; tunnels: Set<Socket> }>();
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };

  async function tunnel(client: Socket, head: string, rest: Buffer): Promise<void> {
    const [requestLine, ...headers] = head.split("\r\n");
    const [method, authority] = requestLine.split(" ");
    if (method !== "CONNECT") return refuse(client, "403 Forbidden", "only HTTPS (CONNECT) is proxied; plain HTTP is refused");
    const grant = grants.get(grantToken(headers) ?? "");
    const decision = egressDecision(authority ?? "", [...options.rules, ...(grant?.hosts ?? [])]);
    if (!decision.allowed) return refuse(client, "403 Forbidden", `${authority}: ${REFUSAL_MESSAGES[decision.reason]}`);

    let addresses: string[];
    try {
      addresses = await resolve(decision.host);
    } catch {
      return refuse(client, "502 Bad Gateway", `${decision.host}: DNS lookup failed`);
    }
    // Checked after resolution so an allowlisted name cannot point the tunnel at a local or internal service.
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
      return refuse(client, "403 Forbidden", `${decision.host} resolves to a non-public address`);
    }

    const upstream = connectUpstream(addresses[0], decision.port);
    track(upstream);
    grant?.tunnels.add(client);
    let connected = false;
    upstream.once("error", () => {
      if (connected) client.destroy();
      else if (!client.destroyed) refuse(client, "502 Bad Gateway", `${authority}: connection failed`);
    });
    upstream.once("connect", () => {
      connected = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const relay = (first: Buffer) => {
        if (decision.port !== SSH_PORT && first[0] !== TLS_HANDSHAKE_RECORD) {
          client.destroy();
          return;
        }
        upstream.write(first);
        client.pipe(upstream).pipe(client);
      };
      if (rest.length > 0) relay(rest);
      else {
        client.once("data", relay);
        client.resume();
      }
    });
    client.once("close", () => upstream.destroy());
  }

  const server = createServer((client) => {
    track(client);
    client.setTimeout(REQUEST_HEAD_TIMEOUT_MS, () => client.destroy());
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffered.length > MAX_REQUEST_HEAD) refuse(client, "431 Request Header Fields Too Large", "request head too large");
        return;
      }
      client.off("data", onData);
      client.pause();
      client.setTimeout(0);
      void tunnel(client, buffered.subarray(0, end).toString("latin1"), buffered.subarray(end + 4));
    };
    client.on("data", onData);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.listen ?? { host: "127.0.0.1", port: 0 }, () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    port,
    grant(hosts) {
      const token = randomBytes(16).toString("hex");
      grants.set(token, { hosts, tunnels: new Set() });
      return token;
    },
    revoke(token) {
      for (const tunnel of grants.get(token)?.tunnels ?? []) tunnel.destroy();
      grants.delete(token);
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

/** Points HTTP clients, Node's built-in fetch and Git over SSH at the proxy; loopback stays direct. */
export function proxyEnvironment(port: number, token?: string): Record<string, string> {
  const credentials = token ? `${PROXY_USER}:${token}@` : "";
  const url = `http://${credentials}127.0.0.1:${port}`;
  const direct = "localhost,127.0.0.1,::1";
  return {
    HTTPS_PROXY: url, https_proxy: url, HTTP_PROXY: url, http_proxy: url,
    NO_PROXY: direct, no_proxy: direct,
    NODE_USE_ENV_PROXY: "1",
    GIT_SSH_COMMAND: `ssh -o ProxyCommand='/usr/bin/nc -X connect -x 127.0.0.1:${port} %h %p'`,
  };
}
