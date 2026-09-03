import assert from "node:assert/strict";
import test from "node:test";
import {
  deniedBashCommandReason,
  hasPluginWorkspaceAccess,
  hasTrustedSharedReadAccess,
  isControlPlaneWriteBlocked,
  isProtectedSecretPath,
  playwrightBrowsersRoot,
  shellPathCandidates,
} from "./policy.ts";

const harness = "/Users/example/coding-harness";
const plugins = "/Users/example/pi-plugins";
const worktreePlugin = `${plugins}/pi-worktree-agents`;
const statusPlugin = `${plugins}/pi-status-footer`;

test("shared harness resources are trusted for reads", () => {
  const shared = `${harness}/shared`;

  assert.equal(hasTrustedSharedReadAccess("read", `${shared}/skills/_shared/rules.md`, shared), true);
  assert.equal(hasTrustedSharedReadAccess("grep", shared, shared), false);
  assert.equal(hasTrustedSharedReadAccess("find", `${shared}/skills`, shared), false);
  assert.equal(hasTrustedSharedReadAccess("read", `${harness}/pi/agent/extensions/index.ts`, shared), false);
  assert.equal(hasTrustedSharedReadAccess("read", `${harness}/shared-other/rules.md`, shared), false);
});

test("coding-harness sessions can access local plugins", () => {
  assert.equal(hasPluginWorkspaceAccess(harness, worktreePlugin, harness, plugins), true);
  assert.equal(hasPluginWorkspaceAccess(`${harness}/shared`, statusPlugin, harness, plugins), true);
});

test("plugin sessions can access sibling plugins", () => {
  assert.equal(hasPluginWorkspaceAccess(worktreePlugin, statusPlugin, harness, plugins), true);
});

test("sessions outside trusted development roots cannot access local plugins", () => {
  assert.equal(hasPluginWorkspaceAccess("/Users/example/projects/app", worktreePlugin, harness, plugins), false);
});

test("trusted sessions do not gain access outside the plugin workspace", () => {
  assert.equal(hasPluginWorkspaceAccess(harness, "/Users/example/projects/app", harness, plugins), false);
});

test("secret paths remain protected inside the plugin workspace", () => {
  assert.equal(isProtectedSecretPath(`${worktreePlugin}/.env.local`), true);
  assert.equal(isProtectedSecretPath(`${harness}/shared/skills/example/.env`), true);
  assert.equal(isProtectedSecretPath(`${worktreePlugin}/certificates/dev.key`), true);
  assert.equal(isProtectedSecretPath(`${worktreePlugin}/extensions/index.ts`), false);
});

test("project-local instruction files remain writable", () => {
  const project = "/Users/example/projects/app";

  assert.equal(isControlPlaneWriteBlocked(project, `${project}/CLAUDE.md`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/AGENTS.md`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/docs/AGENTS.override.md`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, "/Users/example/projects/other/CLAUDE.md", harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(project, "/Users/example/projects/other/AGENTS.md", harness, plugins), true);
});

test("other control-plane writes are allowed only from coding-harness sessions", () => {
  const project = "/Users/example/projects/app";

  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.pi/extensions/demo.ts`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.agent/verify.sh`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.agent/diagnostics.sh`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.git/hooks/pre-commit`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(worktreePlugin, `${worktreePlugin}/extensions/index.ts`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(harness, `${harness}/pi/agent/extensions/sandbox/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(`${harness}/shared`, `${worktreePlugin}/extensions/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/src/index.ts`, harness, plugins), false);
});

test("ordinary Bash commands do not require path inspection", () => {
  assert.deepEqual(shellPathCandidates("git status && npm test"), []);
});

test("the POSIX null device does not require path inspection", () => {
  assert.deepEqual(shellPathCandidates("git diff --no-index -- /dev/null file.txt"), []);
  assert.deepEqual(shellPathCandidates("command > /dev/null"), []);
  assert.deepEqual(shellPathCandidates("cat /dev/zero"), ["/dev/zero"]);
  assert.deepEqual(shellPathCandidates("cat /dev/null/child"), ["/dev/null/child"]);
});

test("session temporary workspaces permit cleanup", () => {
  assert.equal(
    deniedBashCommandReason(
      "rm -rf /private/var/folders/example/T/pi-agent-501/session/output",
      "/Users/example/project",
      "/Users/example",
      "/private/var/folders/example/T/pi-agent-501/session",
    ),
    undefined,
  );
});

test("inline interpreter code does not contribute path candidates", () => {
  const screenshot = "node -e \"page.screenshot({ path: outputDir + '/cv-' + name + '.png' })\"";

  assert.deepEqual(shellPathCandidates(screenshot), []);
  assert.equal(deniedBashCommandReason(screenshot, "/Users/example/project", "/Users/example"), undefined);
  assert.deepEqual(shellPathCandidates("python3 -u -c 'open(\"/etc/hosts\")'"), []);
  assert.deepEqual(shellPathCandidates("node --eval \"run('/a'); run('/b')\""), []);
  assert.deepEqual(shellPathCandidates("/usr/local/bin/node -e \"run('/a')\""), []);
});

test("secret paths inside inline interpreter code stay denied", () => {
  const project = "/Users/example/project";
  const deny = (command: string) => deniedBashCommandReason(command, project, "/Users/example");

  assert.ok(deny("python3 -c \"print(open('/Users/example/.ssh/id_rsa').read())\""));
  assert.ok(deny("python3 -c 'print(open(\"/Users/example/.ssh/id_rsa\").read())'"));
  assert.ok(deny("node -e \"require('fs').readFileSync('/Users/example/.aws/credentials')\""));
  assert.ok(deny("node -e \"require('fs').readFileSync('../secrets/server.pem')\""));
  assert.equal(deny("node -e \"page.screenshot({ path: dir + '/cv-' + name + '.png' })\""), undefined);
});

test("real command arguments outside inline code stay inspected", () => {
  assert.deepEqual(shellPathCandidates("npx playwright screenshot --output /tmp/shot.png"), ["/tmp/shot.png"]);
  assert.deepEqual(shellPathCandidates("node -e \"run()\" > /tmp/log"), ["/tmp/log"]);
  assert.deepEqual(shellPathCandidates("node -e \"run()\" && cat ~/.ssh/id_rsa"), ["~/.ssh/id_rsa"]);
  assert.ok(deniedBashCommandReason("node -e \"run()\" && cat ~/.ssh/id_rsa", "/Users/example/project", "/Users/example"));
  assert.ok(deniedBashCommandReason("bash -c \"git push --force\"", "/Users/example/project", "/Users/example"));
});

test("the Playwright browser cache resolves per platform and override", () => {
  assert.equal(playwrightBrowsersRoot({}, "darwin", "/Users/example"), "/Users/example/Library/Caches/ms-playwright");
  assert.equal(playwrightBrowsersRoot({}, "linux", "/home/example"), "/home/example/.cache/ms-playwright");
  assert.equal(
    playwrightBrowsersRoot({ PLAYWRIGHT_BROWSERS_PATH: "/opt/browsers/" }, "linux", "/home/example"),
    "/opt/browsers",
  );
  assert.equal(playwrightBrowsersRoot({ PLAYWRIGHT_BROWSERS_PATH: "0" }, "darwin", "/Users/example"), "/Users/example/Library/Caches/ms-playwright");
});

test("Bash path inspection still catches explicit and protected paths", () => {
  assert.deepEqual(shellPathCandidates("cp .env.local ~/pi-plugins/demo/config.ts"), [".env.local", "~/pi-plugins/demo/config.ts"]);
  assert.deepEqual(shellPathCandidates("cp payload nested/.agent/verify.sh"), ["nested/.agent/verify.sh"]);
  assert.deepEqual(shellPathCandidates("cp payload nested/.agent/diagnostics.sh"), ["nested/.agent/diagnostics.sh"]);
  assert.deepEqual(shellPathCandidates("printf x > docs/AGENTS.md"), ["docs/AGENTS.md"]);
});
