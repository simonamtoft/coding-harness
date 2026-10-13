import assert from "node:assert/strict";
import test from "node:test";
import { remoteShellProgram, requestRemoteShellConfirmation } from "./remote-shell.ts";

test("SSH-family invocations require confirmation", () => {
  const cases: Array<[string, string]> = [
    ["ssh deploy@example.com uptime", "ssh"],
    ["/usr/bin/ssh host", "ssh"],
    ["\\ssh host", "ssh"],
    ["'ssh' host", "ssh"],
    ["env TERM=xterm ssh host", "ssh"],
    ["FOO=1 command ssh host", "ssh"],
    ["timeout 10 ssh host true", "ssh"],
    ["git status && scp build.tar host:/srv", "scp"],
    ["echo ls | sftp host", "sftp"],
    ["out=$(ssh host cat /etc/hostname)", "ssh"],
    ["for h in a b; do ssh $h uptime; done", "ssh"],
    ["cat hosts | xargs -I{} ssh {} uptime", "ssh"],
    ["cat hosts | xargs -I {} ssh {} uptime", "ssh"],
    ["timeout -s KILL 10 ssh host", "ssh"],
    ["env -u VAR ssh host", "ssh"],
    ["eval ssh host uptime", "ssh"],
    ["eval \"ssh host\"", "ssh"],
    ["s''sh host", "ssh"],
    ["s\\sh host", "ssh"],
    ["if ssh host true; then echo ok; fi", "ssh"],
    ["while ! ssh host true; do sleep 1; done", "ssh"],
    ["timeout 60 rsync -a dist/ host:/srv", "rsync"],
    ["find . -name '*.pub' -exec ssh-copy-id -i {} host ;", "ssh-copy-id"],
    ["sshfs host:/srv ./mnt", "sshfs"],
    ["rsync -av dist/ deploy@host:/srv/app", "rsync"],
    ["rsync -avz -e 'ssh -p 2222' dist/ ./backup", "rsync"],
    ["rsync --rsh=ssh dist/ ./backup", "rsync"],
    ["GIT_SSH_COMMAND='ssh -i key' git fetch", "git with a custom SSH command"],
    ["git -c core.sshCommand='ssh -v' push", "git with a custom SSH command"],
  ];
  for (const [command, program] of cases) assert.equal(remoteShellProgram(command), program, command);
});

test("commands that only mention SSH or use Git's default transport run without confirmation", () => {
  for (const command of [
    "rg ssh README.md",
    "if grep -q ssh config; then echo found; fi",
    "git commit -m 'use ssh keys'",
    "git push origin main",
    "git clone git@github.com:example/repo.git",
    "rsync -av dist/ ./backup",
    "rsync -av host::module ./backup",
    "ls ~/projects/ssh-tools",
    "echo $GIT_SSH_COMMAND",
  ]) assert.equal(remoteShellProgram(command), undefined, command);
});

test("SSH-family confirmation shows the command and fails closed", async () => {
  const titles: string[] = [];
  const approved = await requestRemoteShellConfirmation({
    hasUI: true,
    ui: { select: async (title) => { titles.push(title); return "Allow once"; } },
  }, "ssh", "ssh host uptime");

  assert.equal(approved, true);
  assert.match(titles[0] ?? "", /Program: ssh/);
  assert.match(titles[0] ?? "", /Command: ssh host uptime/);
  assert.equal(await requestRemoteShellConfirmation({ hasUI: true, ui: { select: async () => "Deny" } }, "ssh", "ssh host"), false);
  assert.equal(await requestRemoteShellConfirmation({ hasUI: true, ui: { select: async () => undefined } }, "ssh", "ssh host"), false);
  assert.equal(await requestRemoteShellConfirmation({ hasUI: false, ui: { select: async () => "Allow once" } }, "ssh", "ssh host"), false);
});
