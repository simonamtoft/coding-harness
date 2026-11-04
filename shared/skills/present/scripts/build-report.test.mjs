import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "build-report.mjs");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "present-build-")));
  const session = join(root, "session");
  const repo = join(root, "repo");
  const outside = join(root, "outside");
  for (const path of [session, repo, outside]) mkdirSync(path);
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
  writeFileSync(join(repo, "a.txt"), "two\n");
  return { session, repo, outside };
}

function build(ws, spec) {
  const specPath = join(ws.session, "spec.json");
  writeFileSync(specPath, JSON.stringify({ title: "T", out: join(ws.session, "r.html"), ...spec }));
  return spawnSync("node", [script, specPath], { cwd: ws.repo, encoding: "utf8", env: { ...process.env, PI_SESSION_TMPDIR: ws.session } });
}

const steps = { kind: "steps", title: "S", before: ["a"], after: ["a", { text: "b", new: true }] };

test("builds a static report from steps and a working-tree diff", () => {
  const ws = workspace();
  const result = build(ws, { base: "HEAD", changes: [steps, { kind: "diff", title: "D", file: "a.txt" }] });
  expect(result.status).toBe(0);
  const html = readFileSync(join(ws.session, "r.html"), "utf8");
  expect(html).toContain('<mark class="ins">two</mark>');
  expect(html).not.toContain("<script");
});

test("writes only inside the session workspace", () => {
  const ws = workspace();
  const result = build(ws, { out: join(ws.outside, "r.html"), changes: [steps] });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("out must be inside the session temporary directory");
});

test("embeds images only from the session workspace or repository, and only real images", () => {
  const ws = workspace();
  writeFileSync(join(ws.outside, "x.png"), PNG);
  writeFileSync(join(ws.session, "fake.png"), "TOKEN=1\n");
  writeFileSync(join(ws.session, "ok.png"), PNG);
  const image = (after) => ({ changes: [{ kind: "image", title: "I", after }] });
  expect(build(ws, image(join(ws.outside, "x.png"))).stderr).toContain("images must come from");
  expect(build(ws, image(join(ws.session, "fake.png"))).stderr).toContain("not a valid png");
  expect(build(ws, image(join(ws.session, "ok.png"))).status).toBe(0);
});

test("diffs only non-secret repository paths at plain revisions", () => {
  const ws = workspace();
  const diff = (file, revision = { base: "HEAD" }) => build(ws, { ...revision, changes: [{ kind: "diff", title: "D", file }] });
  expect(diff(".env").stderr).toContain("non-secret path");
  expect(diff("../outside/x").stderr).toContain("outside the repository");
  expect(diff("a.txt", { base: "--output=/tmp/x" }).stderr).toContain("not a plain Git revision");
});

test("rejects text over its length cap", () => {
  const ws = workspace();
  const result = build(ws, { changes: [{ ...steps, note: "x".repeat(141) }] });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("changes[0].note: 141/140 chars");
});
