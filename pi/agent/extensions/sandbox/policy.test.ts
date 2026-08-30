import assert from "node:assert/strict";
import test from "node:test";
import {
  deniedBashCommandReason,
  hasPluginWorkspaceAccess,
  hasTrustedSharedReadAccess,
  isControlPlaneWriteBlocked,
  isProtectedSecretPath,
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
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.git/hooks/pre-commit`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(worktreePlugin, `${worktreePlugin}/extensions/index.ts`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(harness, `${harness}/pi/agent/extensions/sandbox/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(`${harness}/shared`, `${worktreePlugin}/extensions/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/src/index.ts`, harness, plugins), false);
});

test("ordinary Bash commands do not require path inspection", () => {
  assert.deepEqual(shellPathCandidates("git status && npm test"), []);
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

test("Bash path inspection still catches explicit and protected paths", () => {
  assert.deepEqual(shellPathCandidates("cp .env.local ~/pi-plugins/demo/config.ts"), [".env.local", "~/pi-plugins/demo/config.ts"]);
  assert.deepEqual(shellPathCandidates("cp payload nested/.agent/verify.sh"), ["nested/.agent/verify.sh"]);
  assert.deepEqual(shellPathCandidates("printf x > docs/AGENTS.md"), ["docs/AGENTS.md"]);
});
