import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deniedBashCommandReason,
  hasPluginWorkspaceAccess,
  hasResearchVaultReadAccess,
  hasSafeResearchVaultBashPaths,
  hasTrustedSharedReadAccess,
  isControlPlaneWriteBlocked,
  isReadOnlyInspectionCommand,
  isTrustedSharedSkillHelper,
  isProtectedSecretPath,
  isProtectedSecretTarget,
  namesMissingRootEntry,
  playwrightBrowsersRoot,
  permitsRootVerifierScriptBashReference,
  requestResearchVaultConfirmation,
  researchVaultBashOperation,
  researchVaultBashPaths,
  sameRepositoryWorktrees,
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

test("symlinked shared skill helpers retain narrowly-scoped Bash access", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-shared-skills-"));
  const shared = join(root, "shared");
  const helper = join(shared, "skills", "quick-commit", "scripts", "capture_snapshot.sh");
  const scenarioHelper = join(shared, "skills", "visual-verification", "scripts", "capture-scenario.mjs");
  const installedSkills = join(root, "agent", "skills");
  mkdirSync(join(shared, "skills", "quick-commit", "scripts"), { recursive: true });
  mkdirSync(join(shared, "skills", "visual-verification", "scripts"), { recursive: true });
  writeFileSync(helper, "#!/usr/bin/env bash\n");
  writeFileSync(scenarioHelper, "export default {};\n");
  mkdirSync(join(root, "agent"), { recursive: true });
  symlinkSync(join(shared, "skills"), installedSkills);

  try {
    const canonicalShared = realpathSync(shared);
    const resolvedHelper = realpathSync(join(installedSkills, "quick-commit", "scripts", "capture_snapshot.sh"));
    const resolvedScenarioHelper = realpathSync(join(installedSkills, "visual-verification", "scripts", "capture-scenario.mjs"));
    assert.equal(isTrustedSharedSkillHelper(resolvedHelper, canonicalShared), true);
    assert.equal(isTrustedSharedSkillHelper(resolvedScenarioHelper, canonicalShared), true);
    assert.equal(isTrustedSharedSkillHelper(join(canonicalShared, "skills", "present", "scripts", "build-report.mjs"), canonicalShared), true);
    assert.equal(isTrustedSharedSkillHelper(join(canonicalShared, "skills", "present", "scripts", "build-report.test.mjs"), canonicalShared), false);
    assert.equal(isTrustedSharedSkillHelper(join(canonicalShared, "skills", "present", "scripts", "assemble-report.mjs"), canonicalShared), false);
    assert.equal(isTrustedSharedSkillHelper(join(canonicalShared, "skills", "quick-commit", "scripts", "build-report.mjs"), canonicalShared), false);
    assert.equal(isTrustedSharedSkillHelper(join(canonicalShared, "skills", "quick-commit", "SKILL.md"), canonicalShared), false);
    assert.equal(isTrustedSharedSkillHelper(join(canonicalShared, "skills", "quick-commit", "scripts", ".env.sh"), canonicalShared), false);
    assert.equal(isTrustedSharedSkillHelper(join(root, "outside.sh"), canonicalShared), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research-vault reads and documented Bash workflow are scoped to the vault root", () => {
  const vault = "/Users/example/research";

  assert.equal(hasResearchVaultReadAccess("read", `${vault}/notes/topics/example.md`, vault), true);
  assert.equal(hasResearchVaultReadAccess("find", `${vault}/raw`, vault), false);
  assert.equal(hasResearchVaultReadAccess("write", `${vault}/notes/topics/example.md`, vault), false);
  assert.equal(hasResearchVaultReadAccess("read", "/Users/example/research-old/note.md", vault), false);
  assert.equal(researchVaultBashOperation(`cd ${vault} && python3 bin/status.py`, vault), "read");
  assert.equal(researchVaultBashOperation(`cd ${vault} && python3 bin/status.py --write-hashes`, vault), "mutation");
  assert.equal(researchVaultBashOperation(`cd ${vault} && pdftotext raw/papers/source.pdf -`, vault), "read");
  assert.equal(researchVaultBashOperation(`python3 ${vault}/bin/mhtml2txt.py ${vault}/raw/article.mhtml`, vault), "read");
  assert.deepEqual(researchVaultBashPaths(`cd ${vault} && python3 bin/mhtml2txt.py raw/article.mhtml`, vault), [
    `${vault}/bin/mhtml2txt.py`,
    `${vault}/raw/article.mhtml`,
  ]);
  assert.equal(researchVaultBashOperation(`cd ${vault} && python3 bin/status.py --other`, vault), undefined);
  assert.equal(researchVaultBashOperation(`cd ${vault} && pdftotext raw/source.pdf>/tmp/output -`, vault), undefined);
});

test("documented vault Bash reads reject symlink and secret-path escapes", () => {
  const vault = mkdtempSync(join(tmpdir(), "pi-vault-policy-"));
  const outside = mkdtempSync(join(tmpdir(), "pi-vault-outside-"));
  mkdirSync(join(vault, "bin"));
  mkdirSync(join(vault, "raw"));
  writeFileSync(join(vault, "bin", "mhtml2txt.py"), "");
  writeFileSync(join(vault, "bin", "status.py"), "");
  writeFileSync(join(outside, "private.mhtml"), "");
  symlinkSync(join(outside, "private.mhtml"), join(vault, "raw", "escape.mhtml"));
  writeFileSync(join(vault, ".env"), "secret");
  symlinkSync(join(vault, ".env"), join(vault, "raw", "secret.mhtml"));

  try {
    assert.equal(hasSafeResearchVaultBashPaths(`cd ${vault} && python3 bin/status.py`, vault), true);
    assert.equal(hasSafeResearchVaultBashPaths(`cd ${vault} && python3 bin/mhtml2txt.py raw/escape.mhtml`, vault), false);
    assert.equal(hasSafeResearchVaultBashPaths(`cd ${vault} && python3 bin/mhtml2txt.py raw/secret.mhtml`, vault), false);
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("research-vault mutation confirmation identifies the operation and fails closed", async () => {
  const titles: string[] = [];
  const approved = await requestResearchVaultConfirmation({
    hasUI: true,
    ui: { select: async (title) => { titles.push(title); return "Allow once"; } },
  }, "write", "/Users/example/research/notes/source.md");

  assert.equal(approved, true);
  assert.match(titles[0] ?? "", /Operation: write/);
  assert.match(titles[0] ?? "", /Target: \/Users\/example\/research\/notes\/source\.md/);
  assert.equal(await requestResearchVaultConfirmation({ hasUI: true, ui: { select: async () => "Deny" } }, "edit", "target"), false);
  assert.equal(await requestResearchVaultConfirmation({ hasUI: false, ui: { select: async () => "Allow once" } }, "write", "target"), false);
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

test("project verify skills are writable, while other agent resources stay protected", () => {
  const project = "/Users/example/projects/app";
  const blocked = (path: string) => isControlPlaneWriteBlocked(project, path, harness, plugins);

  assert.equal(blocked(`${project}/.agents/skills/verify-app/SKILL.md`), false);
  assert.equal(blocked(`${project}/.agents/skills/verify-app`), false);
  assert.equal(blocked(`${project}/health-claims/.agents/skills/verify-health-claims/features/login.md`), false);
  assert.equal(blocked(`${project}/.agents/skills/verify-app/run.sh`), false);
  assert.equal(blocked(`${project}/.agents/skills/other/SKILL.md`), true);
  assert.equal(blocked(`${project}/.agents/skills/verify-`), true);
  assert.equal(blocked(`${project}/.agents/skills`), true);
  assert.equal(blocked(`${project}/.agents/verify-app/SKILL.md`), true);
  assert.equal(blocked(`${project}/.agents/skills/verify-app/.git/hooks/pre-commit`), true);
  assert.equal(blocked(`${project}/.agents/skills/verify-app/.git/hooks/h/.git/objects/run.sh`), true);
  assert.equal(blocked(`${project}/x/.git/hooks/h/.git/objects/run.sh`), true);
  assert.equal(blocked(`${project}/.agents/skills/verify-app/.pi/extensions/x.ts`), true);
  assert.equal(blocked(`${project}/.pi/x/.agents/skills/verify-app/SKILL.md`), true);
  assert.equal(blocked("/Users/example/projects/other/.agents/skills/verify-app/SKILL.md"), true);
});

test("find patterns and existence probes naming control paths are not path candidates", () => {
  assert.deepEqual(shellPathCandidates("find /tmp/x -path '*/.agents/skills/*' -type f"), ["/tmp/x"]);
  assert.deepEqual(shellPathCandidates("test -d .pi/extensions && echo yes"), []);
  assert.deepEqual(shellPathCandidates('git commit -m "Add .agents/skills/verify-app"'), [".agents/skills/verify-app"]);
  assert.deepEqual(shellPathCandidates("git checkout -m '.pi/x.ts'"), [".pi/x.ts"]);
  assert.deepEqual(shellPathCandidates("rm -rf $(ls -d .pi; true)"), [".pi"]);
  assert.deepEqual(shellPathCandidates("find . -path '*/.pi/*' > list; xargs rm < list"), ["*/.pi/*"]);
  assert.deepEqual(shellPathCandidates("find . -path '*/.agents/*' -delete"), ["*/.agents/*"]);
  assert.deepEqual(shellPathCandidates("find . -path '*/.agents/*' | xargs rm"), ["*/.agents/*"]);
  assert.deepEqual(shellPathCandidates("find . -path ../.agents"), ["../.agents"]);
});

test("repository-root verifier scripts remain writable", () => {
  const project = "/Users/example/projects/app";

  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.agent/verify.sh`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.agent/diagnostics.sh`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/nested/.agent/verify.sh`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/nested/.agent/diagnostics.sh`, harness, plugins), true);
});

test("Bash can stage or mark root verifier scripts executable without executing them", () => {
  const project = "/Users/example/projects/app";
  const verifyScript = `${project}/.agent/verify.sh`;
  const diagnosticsScript = `${project}/.agent/diagnostics.sh`;

  assert.equal(permitsRootVerifierScriptBashReference("git add -- .agent/verify.sh docs/test-audit.md", project, verifyScript), true);
  assert.equal(permitsRootVerifierScriptBashReference(`git add -- ${verifyScript}`, project, verifyScript), true);
  assert.equal(permitsRootVerifierScriptBashReference("chmod +x .agent/diagnostics.sh", project, diagnosticsScript), true);
  assert.equal(permitsRootVerifierScriptBashReference(`chmod +x ${diagnosticsScript}`, project, diagnosticsScript), true);
  assert.equal(permitsRootVerifierScriptBashReference("./.agent/verify.sh", project, verifyScript), false);
  assert.equal(permitsRootVerifierScriptBashReference("bash .agent/verify.sh", project, verifyScript), false);
  assert.equal(permitsRootVerifierScriptBashReference("git add -- .agent/verify.sh && ./.agent/verify.sh", project, verifyScript), false);
  assert.equal(permitsRootVerifierScriptBashReference("git add .agent/verify.sh $(./.agent/verify.sh)", project, verifyScript), false);
  assert.equal(permitsRootVerifierScriptBashReference("chmod +x .agent/verify.sh .agent/diagnostics.sh", project, verifyScript), false);
});

test("plugin sessions can modify plugin source, while unrelated sessions remain blocked", () => {
  const project = "/Users/example/projects/app";

  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.pi/extensions/demo.ts`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/.git/hooks/pre-commit`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(worktreePlugin, `${worktreePlugin}/extensions/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(worktreePlugin, `${statusPlugin}/extensions/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${worktreePlugin}/extensions/index.ts`, harness, plugins), true);
  assert.equal(isControlPlaneWriteBlocked(harness, `${harness}/pi/agent/extensions/sandbox/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(`${harness}/shared`, `${worktreePlugin}/extensions/index.ts`, harness, plugins), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${project}/src/index.ts`, harness, plugins), false);
});

test("ordinary Bash commands do not require path inspection", () => {
  assert.deepEqual(shellPathCandidates("git status && npm test"), []);
});

test("root-path comparisons in shell tests are not filesystem candidates", () => {
  assert.deepEqual(shellPathCandidates('[[ "$PI_SESSION_TMPDIR" != "/" ]]'), []);
  assert.deepEqual(shellPathCandidates('[[ "/" != "$PI_SESSION_TMPDIR" ]]'), []);
  assert.deepEqual(shellPathCandidates('if [[ "$PI_SESSION_TMPDIR" == "/" ]]; then echo invalid; fi'), []);
  assert.deepEqual(shellPathCandidates("[[ -d / ]]"), ["/"]);
  assert.deepEqual(shellPathCandidates("cd /"), ["/"]);
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

test("email addresses in User-Agent or From headers are denied", () => {
  const deny = (command: string) => deniedBashCommandReason(command, "/Users/example/project", "/Users/example");

  assert.ok(deny("curl -H 'User-Agent: research-bot (someone@example.com)' https://en.wikipedia.org/w/api.php"));
  assert.ok(deny("curl -sSA 'Example Co someone@example.com' https://www.sec.gov/cgi-bin/browse-edgar"));
  assert.ok(deny("curl --user-agent=\"bot someone@example.dk\" https://example.org"));
  assert.ok(deny("wget -U 'bot someone@example.com' https://example.org"));
  assert.ok(deny("curl -H 'From: someone@example.com' https://example.org"));
  assert.ok(deny("python3 -c \"requests.get(u, headers={'User-Agent': 'bot someone@example.com'})\""));
  assert.ok(deny("USER_AGENT='bot someone@example.com' node fetch.mjs"));
  assert.ok(deny("cat > fetch.py <<'EOF'\nheaders = {\"user-agent\": \"bot <someone@example.com>\"}\nEOF"));

  assert.equal(deny("curl -A 'research-bot/1.0' https://en.wikipedia.org/w/api.php"), undefined);
  assert.equal(deny("curl -H 'User-Agent: bot/1.0' https://example.org && echo someone@example.com"), undefined);
  assert.equal(deny("grep -A 2 someone@example.com contacts.txt"), undefined);
  assert.equal(deny("git commit -m 'Move email from someone@example.com'"), undefined);
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

test("search patterns and globs are not filesystem candidates", () => {
  assert.deepEqual(shellPathCandidates('rg "/models" README.md'), []);
  assert.deepEqual(shellPathCandidates("rg --files -g AGENTS.md"), []);
  assert.deepEqual(shellPathCandidates("grep -e /models /tmp/input"), ["/tmp/input"]);
  assert.deepEqual(shellPathCandidates("grep -e. ~/.ssh/id_rsa"), ["~/.ssh/id_rsa"]);
  assert.deepEqual(shellPathCandidates("rg -f ~/.ssh/id_rsa ."), ["~/.ssh/id_rsa"]);
  assert.deepEqual(shellPathCandidates("rg --ignore-file=~/.ssh/id_rsa ."), ["~/.ssh/id_rsa"]);
  assert.ok(deniedBashCommandReason("grep -e. ~/.ssh/id_rsa", "/Users/example/project", "/Users/example"));
  assert.ok(deniedBashCommandReason("rg -f ~/.ssh/id_rsa .", "/Users/example/project", "/Users/example"));
});

test("interpreter heredocs, sed and awk programs, and quoted prose are not path candidates", () => {
  assert.deepEqual(shellPathCandidates("python3 - <<'EOF'\ns = s.replace(' // 2', '/x')\nopen('/etc/hosts')\nEOF"), []);
  assert.deepEqual(shellPathCandidates("backlog task view X --plain | sed -n '/Implementation Notes/,$p' | tail -n +20"), []);
  assert.deepEqual(shellPathCandidates("grep -n '' README.md | sed -n '/onfiguration/,/^[0-9]*:## /p'"), []);
  assert.deepEqual(shellPathCandidates("awk 'f;/Implementation Notes/{f=1}' notes.txt"), []);
  assert.deepEqual(shellPathCandidates("sed -e '/a/d' -e '/b/d' input"), []);
  assert.deepEqual(shellPathCandidates('backlog task edit X --notes "POST /speechtotext/x then /openai/v1 (see /)"'), []);
  assert.deepEqual(shellPathCandidates("backlog task edit X --final-summary='Rejected per /Acceptance/,/Definition/p'"), []);
});

test("masked shell text keeps real operands and protected secrets", () => {
  assert.deepEqual(shellPathCandidates("sed -n '/x/p' /etc/hosts"), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates("sed -f /etc/script.sed input"), ["/etc/script.sed"]);
  assert.deepEqual(shellPathCandidates("awk -f /etc/prog.awk input"), ["/etc/prog.awk"]);
  assert.deepEqual(shellPathCandidates('cat "/etc/my file"'), ["/etc/my"]);
  assert.deepEqual(shellPathCandidates('cat "../outside file"'), ["../outside"]);
  assert.deepEqual(shellPathCandidates("bash <<'EOF'\ncat /etc/hosts\nEOF"), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates("python3 - <<'EOF'\nprint(1)"), []);
  assert.deepEqual(shellPathCandidates("python3 - <<'EOF'\nprint(1)\nEOF\ncat /etc/hosts"), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates('echo "$(cat "/etc/a b")"'), ["/etc/a"]);
  assert.deepEqual(shellPathCandidates("python3 - <<'EOF'\nopen('/Users/example/.ssh/id_rsa')\nEOF"), ["/Users/example/.ssh/id_rsa"]);
  assert.deepEqual(shellPathCandidates('echo "see backend/.env for keys"'), ["backend/.env"]);
});

test("masking never hides executed text, file-writing programs, redirect targets, or control paths", () => {
  assert.deepEqual(shellPathCandidates('eval "cat /etc/hosts"'), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates("git -c alias.x='!cat /etc/hosts' x"), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates("sed -n '1w /Users/example/.pi/agent/AGENTS.md' input"), ["/Users/example/.pi/agent/AGENTS.md"]);
  assert.deepEqual(shellPathCandidates("sed -n '/x/r /etc/hosts' input"), ["/x/r", "/etc/hosts"]);
  assert.deepEqual(shellPathCandidates("awk 'BEGIN{print > \"/etc/x\"}'"), ["/etc/x"]);
  assert.deepEqual(shellPathCandidates("awk 'BEGIN{system(\"cat /etc/hosts\")}'"), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates('cp /tmp/payload ".pi/extensions/my ext.ts"'), ["/tmp/payload", ".pi/extensions/my"]);
  assert.deepEqual(shellPathCandidates('echo "x y" > ".pi/extensions/a b.ts"'), [".pi/extensions/a"]);
  assert.deepEqual(shellPathCandidates('echo "edit .agents/skills now" > out'), [".agents/skills"]);
  assert.deepEqual(shellPathCandidates("python3 - <<EOF\nx = \"$(cat /etc/hosts)\"\nEOF"), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates('git commit -m "fix /a and /b"'), []);
});

test("awk regex and string literals and cat or tee heredoc data are not path candidates", () => {
  assert.deepEqual(shellPathCandidates("awk '/\\f/{p++} /Introduction|Related Work/{print p+1\": \"substr($0,1,90)}' x.txt"), []);
  assert.deepEqual(shellPathCandidates("awk '/^<<<<<<< /{p=1} p{print} /^>>>>>>> /{p=0}' README.md"), []);
  assert.deepEqual(shellPathCandidates("awk '$3 >= 2 || /a|b/' f"), []);
  assert.deepEqual(shellPathCandidates("cat > $PI_SESSION_TMPDIR/u.sh <<'EOF'\npython /probe/wait_db.py\nEOF\necho done"), []);
  assert.deepEqual(shellPathCandidates("tee x.md <<'EOF' >/dev/null\nPOST /api/health\nEOF"), []);
  assert.ok(shellPathCandidates("awk '{print x/1 > \"/etc/x\" /1}'").includes("/etc/x"));
  assert.ok(shellPathCandidates("awk '/a/{print | \"cat /etc/hosts\"}'").includes("/etc/hosts"));
  assert.deepEqual(shellPathCandidates("cat <<EOF\n$(cat /etc/hosts)\nEOF"), ["/etc/hosts"]);
  assert.ok(shellPathCandidates("awk 'BEGIN { ARGV[1] = \"/etc/hosts\"; ARGC = 2 } { print }'").includes("/etc/hosts"));
  assert.deepEqual(shellPathCandidates("cat <<< x\ncat /etc/hosts"), ["/etc/hosts"], "a here-string is not a heredoc");
});

function directoryFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-cd-")));
  mkdirSync(join(root, "repo/backend/src"), { recursive: true });
  mkdirSync(join(root, "repo/scripts"));
  mkdirSync(join(root, "tmp/session"), { recursive: true });
  symlinkSync(join(root, "tmp"), join(root, "repo/link"));
  const repo = join(root, "repo");
  const context = {
    cwd: repo,
    home: join(root, "home"),
    realpath: (path: string) => existsSync(path) ? realpathSync(path) : path,
    isDirectory: (path: string) => existsSync(path),
    variables: { PI_SESSION_TMPDIR: join(root, "tmp/session") },
  };
  return { root, repo, context };
}

test("relative paths after a literal cd resolve against the directory the command runs in", () => {
  const { root, repo, context } = directoryFixture();
  try {
    const paths = (command: string) => shellPathCandidates(command, context);
    assert.deepEqual(paths("cd backend && uv run ruff format ../scripts/x.py"), [join(repo, "scripts/x.py")]);
    assert.deepEqual(paths("cd backend/src; sed -n 1,5p ../../scripts/x.py"), [join(repo, "scripts/x.py")]);
    assert.deepEqual(paths("cd $PI_SESSION_TMPDIR && cat ./a.log"), [join(root, "tmp/session"), join(root, "tmp/session/a.log")]);
    assert.deepEqual(paths("cd \"${PI_SESSION_TMPDIR}/../..\" && ls"), [join(root, "tmp/session/../..")]);
    assert.deepEqual(paths("cd link && cat ../x"), [join(root, "x")], "symlinked directories resolve physically");
    assert.deepEqual(paths("(cd backend && make) && cat ../x"), ["../x"], "subshell cd does not leak");
    assert.deepEqual(paths("echo $(cd backend && pwd) && cat ../x"), ["../x"]);
    assert.deepEqual(paths("cd backend | true; cat ../x"), ["../x"], "pipeline members run in subshells");
    assert.deepEqual(paths("cd new; cat ../x").sort(), [join(root, "x"), join(repo, "x")].sort(), "a missing target may fail");
    assert.deepEqual(paths("test -d backend && cd backend; cat ../x").sort(), [join(root, "x"), join(repo, "x")].sort());
    assert.deepEqual(paths("cd backend && cat ../x"), [join(repo, "x")], "the && chain runs only after cd succeeded");
    assert.deepEqual(paths("pushd backend; popd; cat ../x").sort(), [join(root, "x"), join(repo, "x")].sort());
    assert.deepEqual(paths("cat <<EOF\ncd backend/src\nEOF\ncat ../../x"), ["../../x"], "heredoc text cannot move the shell");
    assert.deepEqual(paths("cd $UNKNOWN && cat ../x"), ["../x"]);
    assert.deepEqual(paths("cd backend 2>&1 && cat ../x"), [join(repo, "x")]);
    assert.deepEqual(paths("cd -- backend && cat ../x"), [join(repo, "x")]);
    assert.deepEqual(paths("if true; then cd backend; fi; cat ../x").sort(), [join(root, "x"), join(repo, "x")].sort(),
      "a cd in an if body may not run");
    assert.deepEqual(paths("cd backend || cat ../x"), ["../x"], "the command after || runs only when cd failed");
    assert.deepEqual(paths("cd backend || exit; cat ../x"), [join(repo, "x")]);
    assert.deepEqual(paths("cat <<< x >/dev/null\ncd link\ncat ./f"), [join(root, "tmp/f")], "a here-string is not a heredoc");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("read-only inspection commands are recognised conservatively", () => {
  for (const command of [
    "grep -n 'model' /pi/docs/a.md | head -20",
    "cd /pi && rg -n 'x|y' dist 2>/dev/null | head",
    "sed -n '1,40p' /pi/README.md",
    "find /pi -name '*.md' -maxdepth 2 2>&1 | wc -l",
  ]) assert.equal(isReadOnlyInspectionCommand(command), true, command);
  for (const command of [
    "grep x /pi/a > out",
    "sed -i '' 's/a/b/' /pi/a",
    "sed -n '1w /pi/b' /pi/a",
    "find /pi -delete",
    "find /pi -exec rm {} +",
    "rg --pre ./x pattern /pi",
    "cat $(echo /pi/a)",
    "cp /pi/a b",
    "FOO=1 cat /pi/a",
    "sed -I.bak 's/x/y/' /pi/a",
    "sed -n -e p -f prog /pi/a",
    "sed --expression=p /pi/a",
  ]) assert.equal(isReadOnlyInspectionCommand(command), false, command);
});

test("sibling worktrees of the session repository are listed; unrelated or broad paths are not", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-worktrees-")));
  try {
    const main = join(root, "main");
    mkdirSync(main);
    execFileSync("git", ["init", "-q", main]);
    execFileSync("git", ["-C", main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"]);
    execFileSync("git", ["-C", main, "worktree", "add", "-q", join(root, "wt")]);
    assert.deepEqual(sameRepositoryWorktrees(main, join(root, "home")), [join(root, "wt")]);
    assert.deepEqual(sameRepositoryWorktrees(join(root, "wt"), join(root, "home")), [main]);
    assert.deepEqual(sameRepositoryWorktrees(main, join(root, "wt/inner")), [], "a worktree containing home is dropped");
    assert.deepEqual(sameRepositoryWorktrees(join(root, "nothing")), []);
    const other = join(root, "other");
    mkdirSync(other);
    execFileSync("git", ["init", "-q", other]);
    mkdirSync(join(main, ".git/worktrees/forged"));
    writeFileSync(join(main, ".git/worktrees/forged/gitdir"), `${join(other, ".git")}\n`);
    assert.deepEqual(sameRepositoryWorktrees(main, join(root, "home")), [join(root, "wt")], "a record without a link back is ignored");
    writeFileSync(join(root, "wt/.git"), `gitdir: ${join(other, ".git")}\n`);
    assert.deepEqual(sameRepositoryWorktrees(join(root, "wt"), join(root, "home")), [], "a forged session .git file grants nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only a Git-tracked file named exactly .env.example is exempt from secret protection", () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "pi-env-template-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  try {
    git("init", "-q");
    mkdirSync(join(repo, "backend"));
    for (const name of [".env.example", ".env", ".env.sample"]) writeFileSync(join(repo, "backend", name), "KEY=");
    writeFileSync(join(repo, ".env.example"), "KEY=");
    mkdirSync(join(repo, "linked"));
    symlinkSync(join(repo, "backend", ".env"), join(repo, "linked", ".env.example"));
    git("add", "backend/.env.example", "backend/.env.sample", "linked/.env.example");

    const nested = join(repo, "nested");
    mkdirSync(nested);
    const marker = join(repo, "fsmonitor-ran");
    execFileSync("git", ["init", "-q"], { cwd: nested, stdio: "ignore" });
    writeFileSync(join(nested, ".env.example"), "KEY=");
    execFileSync("git", ["add", ".env.example"], { cwd: nested, stdio: "ignore" });
    execFileSync("git", ["config", "core.fsmonitor", `touch ${marker}`], { cwd: nested, stdio: "ignore" });
    const target = (...parts: string[]) => isProtectedSecretTarget(join(repo, ...parts), repo);

    assert.equal(target("backend", ".env.example"), false);
    assert.equal(target(".env.example"), true, "untracked");
    assert.equal(target("backend", ".env.sample"), true, "tracked, other name");
    assert.equal(target("backend", ".env"), true);
    assert.equal(target("backend", "missing", ".env.example"), true);
    assert.equal(target("linked", ".env.example"), true, "tracked symlink to .env");
    assert.equal(isProtectedSecretTarget(join(repo, "backend", ".env.example"), join(repo, "linked")), true, "outside the session root");
    assert.equal(target("nested", ".env.example"), true, "tracked only by a nested repository");
    assert.equal(isProtectedSecretTarget(join(nested, ".env.example"), repo), true);
    assert.equal(existsSync(marker), false, "nested repository config must not run");
    assert.equal(deniedBashCommandReason("cat backend/.env.example", repo, "/Users/example"), undefined);
    assert.ok(deniedBashCommandReason("cat .env.example", repo, "/Users/example"));
    assert.ok(deniedBashCommandReason("cat backend/.env.example backend/.env", repo, "/Users/example"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("absolute text whose top-level entry is missing names no host file", () => {
  for (const text of ["/subscriptions/abc/resourceGroups/rg", "/app/backend/seed", "/%s/%s", "/len", "/Users\\|^Use"]) {
    assert.equal(namesMissingRootEntry(text), true, text);
  }
  for (const path of ["/", "/etc/hosts", "/tmp/x", "/Users/example", "relative/path", "~/x"]) {
    assert.equal(namesMissingRootEntry(path), false, path);
  }
  assert.equal(namesMissingRootEntry("/*/example/file"), false, "a glob may expand to an existing entry");
  assert.equal(namesMissingRootEntry("/{Users,tmp}/x"), false, "brace expansion");
  assert.equal(namesMissingRootEntry("/$ROOT/x"), false, "variable expansion");
  assert.equal(namesMissingRootEntry("/Use\\rs/example"), false, "a backslash may escape an existing name");
});

test("uv run interpreter heredocs are masked like direct interpreter heredocs", () => {
  assert.deepEqual(shellPathCandidates("uv run python - \"$M\" <<'EOF'\nprint(len(x)/len(y))\nEOF"), []);
  assert.deepEqual(shellPathCandidates("uv run bash <<'EOF'\ncat /etc/hosts\nEOF"), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates("uv run --with python bash <<'EOF'\ncat /etc/hosts\nEOF"), ["/etc/hosts"]);
});

test("the rm check stops at a newline", () => {
  const project = "/Users/example/project";
  assert.equal(deniedBashCommandReason("rm -f $C\ncurl -o /dev/null https://example.com", project, "/Users/example"), undefined);
  assert.equal(deniedBashCommandReason("rmdir build\nmkdir -p ../infra/docs", project, "/Users/example"), undefined);
  assert.ok(deniedBashCommandReason("rm -f x\nrm -rf /etc", project, "/Users/example"));
});

test("project instruction copies in the session workspace are not control-plane paths", () => {
  const project = "/Users/example/projects/app";
  const temp = "/private/var/folders/example/T/pi-agent-501/session";
  assert.equal(isControlPlaneWriteBlocked(project, `${temp}/stage/AGENTS.md`, harness, plugins, temp), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${temp}/stage/CLAUDE.md`, harness, plugins, temp), false);
  assert.equal(isControlPlaneWriteBlocked(project, `${temp}/stage/.pi/extensions/x.ts`, harness, plugins, temp), true);
  assert.equal(isControlPlaneWriteBlocked(project, `${temp}/stage/.git/hooks/pre-commit`, harness, plugins, temp), true);
  assert.equal(isControlPlaneWriteBlocked(project, `${temp}/stage/AGENTS.md`, harness, plugins), true);
});

test("key and certificate protection requires a file-name stem", () => {
  for (const path of [
    "server.key", "certs/dev.pem", ".server.key", "*.key", "${DIR}.key", "/etc/ssl/private/site.key",
    "keys/My Cert.pem", "backup(1).pem", "Zertifikat-für.pem", "id~.key",
  ]) {
    assert.equal(isProtectedSecretPath(path), true, path);
  }
  for (const text of [".key", "\\(.key", "to_entries[]|\\(.value)\\t\\(.key", ".items[].key", "keyfile.json"]) {
    assert.equal(isProtectedSecretPath(text), false, text);
  }
  assert.deepEqual(shellPathCandidates("jq -r 'to_entries[] | \"\\(.value)\\t\\(.key)\"' f.json"), []);
});

test("dot-env existence probes and stored prose do not expose contents", () => {
  const project = "/Users/example/project";
  const denied = (command: string) => deniedBashCommandReason(command, project, "/Users/example");
  for (const command of [
    "ls .env 2>&1",
    "ls -la backend/.env",
    "test -e backend/.env && echo yes",
    "[ -f .env ] || echo missing",
    "if [[ -f .env ]]; then echo ok; fi",
    "git check-ignore -v backend/.env infra/.terraform",
    "git -C . check-ignore .env",
    "find . -name .env -type f",
    'backlog task edit X --plan "copy .env.example to .env and fill it in"',
    'backlog task edit X --plan "see ../notes and backend/.env"',
    'git commit -m "Ignore backend/.env"',
  ]) assert.equal(denied(command), undefined, command);
  for (const command of [
    "cat .env",
    "source backend/.env",
    "ls .env | xargs cat",
    "cat $(ls .env)",
    "find . -name .env -exec cat {} \\;",
    "ls .env; cat .env",
    "test -e .env && cat .env",
    "ls ../.env",
    "ls ~/.env",
    "ls backend/.ssh/.env",
    "ls x > .env",
    'echo ".env" | xargs cat',
    'echo "see backend/.env for keys"',
    'git commit -m "see ~/.ssh/id_rsa"',
  ]) assert.ok(denied(command), command);
});

test("printed prose feeding a pipeline or substitution stays inspected", () => {
  assert.deepEqual(shellPathCandidates('echo "x /etc/hosts" | xargs cat'), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates('cat $(printf "a /etc/hosts b")'), ["/etc/hosts"]);
  assert.deepEqual(shellPathCandidates('echo "POST /api/health then retry"; ls'), []);
});

test("Bash path inspection still catches explicit and protected paths", () => {
  assert.deepEqual(shellPathCandidates("cp .env.local ~/pi-plugins/demo/config.ts"), [".env.local", "~/pi-plugins/demo/config.ts"]);
  assert.deepEqual(shellPathCandidates("cp payload nested/.agent/verify.sh"), ["nested/.agent/verify.sh"]);
  assert.deepEqual(shellPathCandidates("cp payload nested/.agent/diagnostics.sh"), ["nested/.agent/diagnostics.sh"]);
  assert.deepEqual(shellPathCandidates("printf x > docs/AGENTS.md"), ["docs/AGENTS.md"]);
});
