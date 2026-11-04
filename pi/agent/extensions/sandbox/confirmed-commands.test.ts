import assert from "node:assert/strict";
import test from "node:test";
import {
  AZURE_SESSION_CHOICE,
  azureCredentialProgram,
  confirmedCommand,
  requestAzureCredentials,
  requestCommandConfirmation,
} from "./confirmed-commands.ts";

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
    ["export GIT_SSH_COMMAND='ssh -i key'", "git with a custom SSH command"],
    ["echo \"host: $(ssh host hostname)\"", "ssh"],
    ["echo `ssh host hostname`", "ssh"],
    ["diff <(ssh host cat /etc/hosts) hosts", "ssh"],
    ["bash -c 'ssh host uptime'", "ssh"],
    ["sh -lc \"cd /srv && scp a host:/b\"", "scp"],
    ["ssh host uptime 2>&1 | tee log", "ssh"],
    // Redirections may precede the command word.
    ["2>/dev/null ssh host uptime", "ssh"],
    ["2>&1 scp f host:/x", "scp"],
    ["</dev/null ssh host", "ssh"],
    ["> out.log ssh host", "ssh"],
    ["&>log FOO=1 ssh host", "ssh"],
    ["cd x && >>log 2>&1 ssh host", "ssh"],
    ["cat <<'EOF' > notes.md\nssh in the body\nEOF\nssh host", "ssh"],
    ["git status \\\n  && ssh host", "ssh"],
    ["command ssh -v host", "ssh"],
    ["timeout 10 command scp -v f host:/x", "scp"],
    ["env -S 'ssh host uptime'", "ssh"],
    ["env --split-string='ssh host'", "ssh"],
    ["echo $'\\''; ssh host #'", "ssh"],
    ["(( x = 1<<2 ))\nssh host", "ssh"],
    ["bash <<'EOF'\nssh host uptime\nEOF", "ssh"],
    ["cat <<EOF\n$(ssh host id)\nEOF", "ssh"],
    ["cat <<EOF\nnever closed\nssh host", "ssh"],
    ["git --config-env=core.sshCommand=V fetch", "git with a custom SSH command"],
    ["GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0=x git fetch", "git with a custom SSH command"],
    ["declare -x GIT_SSH_COMMAND='ssh -i key'", "git with a custom SSH command"],
  ];
  for (const [command, program] of cases) {
    assert.deepEqual(confirmedCommand(command), { category: "SSH-family", program }, command);
  }
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
    "git commit -m \"fix; ssh setup\"",
    "git commit -m \"explain keys (ssh-agent)\"",
    "rg 'foo|ssh' README.md",
    "rg \"ssh|scp\" src",
    "echo \"a && ssh host\"",
    "echo 'GIT_SSH_COMMAND=x'",
    "cat <<'EOF' > notes.md\nssh host\nEOF",
    "cat <<-EOF\n\tssh host\n\tEOF",
    "python3 -c \"print('x'); ssh\"",
    "echo $(echo ssh)",
    "xargs grep ssh",
    "timeout 10 grep -r ssh .",
    "env FOO=1 rg ssh",
    "command -v ssh",
    "cat <<\"EOF\"\n$(ssh host id)\nEOF",
    "ls # then ssh host",
    "git log --grep='ssh|terraform apply'",
  ]) assert.equal(confirmedCommand(command), undefined, command);
});

test("state-changing Terraform invocations require confirmation", () => {
  const cases: Array<[string, string]> = [
    ["terraform apply -auto-approve", "terraform apply"],
    ["terraform -chdir=infra destroy", "terraform destroy"],
    ["tf apply", "tf apply"],
    ["tofu import aws_s3_bucket.b my-bucket", "tofu import"],
    ["terraform init -input=false -migrate-state", "terraform init"],
    ["terraform init -input=false -backend-config=dev.hcl -force-copy", "terraform init"],
    ["tofu init -input=false --migrate-state=true", "tofu init"],
    ["terraform init -input=false -migrate-state=false -migrate-state", "terraform init"],
    // Without -input=false a piped answer can accept Terraform's migration prompt.
    ["terraform init -backend-config=dev.hcl", "terraform init"],
    ["yes | terraform init -upgrade", "terraform init"],
    ["terraform init -input=false -input=true", "terraform init"],
    // TF_CLI_ARGS and TF_CLI_ARGS_init append flags Terraform honours.
    ["TF_CLI_ARGS_init=-force-copy terraform init -input=false", "terraform init"],
    ["export TF_CLI_ARGS=-migrate-state; terraform init -input=false", "terraform init"],
    ["env TF_CLI_ARGS_init=-force-copy terraform init -input=false", "terraform init"],
    ["export TF_CLI_ARGS_init=-force-copy; sh -c 'terraform init -input=false'", "terraform init"],
    ["terraform state rm aws_instance.web", "terraform state rm"],
    ["terraform workspace new staging", "terraform workspace new"],
    ["terraform force-unlock 1234", "terraform force-unlock"],
    ["terragrunt run-all apply", "terragrunt apply"],
    ["terragrunt destroy-all", "terragrunt destroy-all"],
    ["terragrunt --working-dir live/prod destroy", "terragrunt destroy"],
    ["cd infra && terraform apply", "terraform apply"],
    [">out.log terraform apply", "terraform apply"],
    ["2> err.log terraform -chdir=infra destroy", "terraform destroy"],
    ["timeout 600 ./bin/terraform apply", "terraform apply"],
    ["grep x <<< \"$(terraform apply)\"", "terraform apply"],
  ];
  for (const [command, program] of cases) {
    assert.deepEqual(confirmedCommand(command), { category: "state-changing Terraform", program }, command);
  }
});

test("read-only Terraform commands run without confirmation", () => {
  for (const command of [
    "terraform fmt -check",
    "terraform validate",
    "terraform plan -destroy -out=apply.tfplan",
    "terraform show -json",
    "terraform output",
    "terraform state list",
    "terraform state show aws_instance.web",
    "terraform workspace list",
    "terragrunt run-all plan",
    "terragrunt plan-all",
    "terraform init -backend=false -input=false",
    "cd infra && terraform init --backend=false",
    "terraform init -upgrade -input=false",
    "terraform init -reconfigure -backend-config=backend/dev.hcl -input=false",
    "terraform -chdir=infra init -input=false -migrate-state=false",
    "terraform init -force-copy=false --input=false",
    "rg 'terraform apply' docs",
  ]) assert.equal(confirmedCommand(command), undefined, command);
});

test("confirmation shows the command and fails closed", async () => {
  const ssh = { category: "SSH-family", program: "ssh" } as const;
  const titles: string[] = [];
  const approved = await requestCommandConfirmation({
    hasUI: true,
    ui: { select: async (title) => { titles.push(title); return "Allow once"; } },
  }, ssh, "ssh host uptime");

  assert.equal(approved, true);
  assert.match(titles[0] ?? "", /Program: ssh/);
  assert.match(titles[0] ?? "", /Command: ssh host uptime/);
  assert.equal(await requestCommandConfirmation({ hasUI: true, ui: { select: async () => "Deny" } }, ssh, "ssh host"), false);
  assert.equal(await requestCommandConfirmation({ hasUI: true, ui: { select: async () => undefined } }, ssh, "ssh host"), false);
  assert.equal(await requestCommandConfirmation({ hasUI: false, ui: { select: async () => "Allow once" } }, ssh, "ssh host"), false);
});

test("Azure CLI and Terraform invocations need the Azure credentials", () => {
  const cases: Array<[string, string]> = [
    ["az account show", "az"],
    ["/opt/homebrew/bin/az group list", "az"],
    ["env AZURE_CORE_OUTPUT=json az vm list", "az"],
    ["timeout 30 az login --use-device-code", "az"],
    ["cd infra && terraform plan", "terraform"],
    ["out=$(az account show)", "az"],
    ["bash -c 'az storage account list'", "az"],
    ["eval az version", "az"],
    ["tofu init", "tofu"],
  ];
  for (const [command, program] of cases) assert.equal(azureCredentialProgram(command), program, command);
  for (const command of ["echo az", "rg 'az account' docs", "lazygit", "git commit -m 'az fix'", "./scripts/deploy.sh"]) {
    assert.equal(azureCredentialProgram(command), undefined, command);
  }
});

test("Azure credential approval distinguishes once, session and denial, and fails closed", async () => {
  const titles: string[] = [];
  const ask = (answer: string | undefined) => ({
    hasUI: true,
    ui: { select: async (title: string) => { titles.push(title); return answer; } },
  });
  assert.equal(await requestAzureCredentials(ask("Allow once"), "az", "az account show"), "once");
  assert.equal(await requestAzureCredentials(ask(AZURE_SESSION_CHOICE), "az", "az account show"), "session");
  assert.equal(await requestAzureCredentials(ask("Deny"), "az", "az account show"), "denied");
  assert.equal(await requestAzureCredentials(ask(undefined), "az", "az account show"), "denied");
  assert.equal(await requestAzureCredentials({ hasUI: false, ui: { select: async () => "Allow once" } }, "az", "az"), "denied");
  assert.match(titles[0] ?? "", /Command: az account show/);
});
