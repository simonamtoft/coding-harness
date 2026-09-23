# Probe-child containment design (PI-90)

**Status: design, not installed protection.** `run.ts` still launches Pi children on the host.
Do not treat a disposable fixture or the Pi sandbox extension as an OS boundary. This design
applies to *isolated* trials; `whole` deliberately uses the installed harness and retains its
host-access limitations. No manual probe command is changed by this document.

## Boundary to build

Use an ephemeral Linux VM or container with a kernel-enforced filesystem and process boundary,
not a Nix shell or a tool-call denylist. On macOS a Linux VM is the strongest portable default;
a container is acceptable only when its runtime provides the same isolation from the host and
no privileged host sockets are mounted. Refuse an isolated run if the backend, mount policy,
network policy, or credential broker is unavailable. Never fall back to `sandbox-exec` or the
current host launch on a failed preflight. Seatbelt is useful for a local proof of concept but
requires a separate, audited, fail-closed profile and does not itself supply the model-provider
credential boundary below.

Keep the parent runner on the host. For **every** isolated Pi child (fixture agent, tool-less
judge, and re-judge), allocate a fresh guest with only:

- an editable copy of that trial's fixture as its working directory; for the judge, no fixture;
- a read-only snapshot of the selected instructions, minimal Pi runtime and canonical sandbox
  extension and its required imports, plus the run's prompt; never bind-mount the checkout or
  installed Pi directories, even read-only (they may contain unexpected files or symlinks);
- a fresh guest HOME, temp directory, and `PI_CODING_AGENT_DIR` containing only generated
  nonsecret configuration for the selected model; no host home, session history, auth files,
  package cache, SSH agent, Docker socket, cloud metadata socket, or other host device/socket;
- an explicit allowlist of ordinary, nonsecret environment variables, not `...process.env`.
  No provider key, token, proxy credential, or path to one may enter the guest.

The child needs model access. A host-owned **provider broker** must authenticate to the
provider outside the guest, accept requests only from the allocated guest, and restrict that
guest's network to the broker (deny all other egress, including DNS, loopback-to-host services,
and forwarded ports). The guest may hold a nonsecret per-run routing identifier, not a reusable
broker secret. The broker must support the actual Pi protocol and auth modes used by each
selected provider, including token refresh where applicable; unsupported models fail preflight.
Do not assume a generic OpenAI-compatible proxy can stand in for Codex OAuth or Anthropic.
Keep responses and streamed usage compatible with Pi. The broker must prevent a request from
selecting an unapproved provider or account. Its logs and guest outputs must not include host
credentials. A simple `--api-key` flag, inherited API key, or read-only host auth mount does **not**
meet this boundary: the child or one of its tools can inspect it.

Only the parent can access result records and the broker's credentials. Pass the guest's JSON
transcript back over an owned output pipe and validate the exit/completion as the runner does
now. Snapshot inputs before starting the guest, validate mount targets and symlinks, and mount
only the snapshot; keep package managers offline and no privileged container options. A guest
may change its own fixture, start background jobs, or exhaust resources; use per-guest CPU,
memory, PID and time limits and destroy the guest and its writable storage after exit. Process
cleanup is a fallback, not the isolation mechanism. Treat fixture `checkCommand` and
`reportCommand` as potentially untrusted **after** the agent edits the fixture: run both in the
same confined environment with model access disabled. The pristine pre-run check must also use
that environment so host execution of fixture scripts is never required. Export only the final
fixture delta needed for assertions and validate it as data (including symlinks), never execute
it on the host. `git show`, runtime fingerprinting, and record writes remain parent operations.

### Rollout gates

1. On both supported host platforms, prove that child, Bash subprocess, and surviving
   background process cannot read, write, or follow symlinks to a marker outside the allocated
   guest, including the host checkout, home, temp, and another trial's fixture. Check the same
   restrictions in post-agent fixture checks and tool-less judge runs.
2. Show no host settings, environment secrets, auth state, privileged socket, or real provider
   credential is readable in the guest; demonstrate selected provider calls via the broker and
   demonstrate denied direct network destinations. Test both configured model providers, not
   just a fake endpoint. Test unavailable backend and broker failures for a **refusal**, never
   a host fallback.
3. Add an offline fake-Pi lifecycle test of launch, timeout, cleanup, and output capture, with
   no paid model calls. Run a deliberate manual paid trial in each mode to check model behavior
   before relying on the new path. Update `RUNNER_VERSION` when the execution path changes:
   prior host-run isolated records must not silently count as contained results.
4. Document the exact backend versions, mounts, broker limits, and remaining guest-to-host
   attack surface after implementation. Preserve the existing `whole` mode, label it explicitly
   uncontained, and do not silently apply isolated restrictions that change what it measures.

## Local feasibility check (2026-09-23, macOS)

`/usr/bin/sandbox-exec` is present and a disposable `allow default` profile denying reads and
writes to a sibling marker directory returned `EPERM` for direct reads, writes, a symlink from
an allowed directory, and a spawned Bun child; reading the allowed marker succeeded. This is
only evidence for that narrow deny rule, **not** a default-deny Pi profile, network isolation,
provider authentication, or a portable launcher. `docker info` could not connect to a daemon;
`nix`, `colima`, and `bwrap` were not available in PATH. No real Pi child, model request, or
credential was used. Until the rollout gates pass, isolated runs remain uncontained host
processes with the existing lexical Pi guard; whole-mode runs are also uncontained.
