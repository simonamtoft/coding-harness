# Confidential mode

Pi with the local Gemma model and no other network access, for client work
whose code or data must not reach any external service. `start.sh` runs the
whole Pi process (its tools, extensions, MCP servers and Bash commands) under a
macOS Seatbelt profile built by
`pi/agent/extensions/sandbox/confidential-profile.ts`:

- Outbound connections are denied except to `127.0.0.1:8080`, the Gemma server.
  This also blocks DNS, Unix-domain sockets, other localhost services and
  Paseo's agent tools on port 6767.
- LaunchServices and Apple Events are denied, so `open URL` and `osascript`
  cannot make another app send data. The DNS and background URL-session
  daemons are denied for the same reason.
- Writes are limited to the checkout, the temp and cache directories, Pi's
  `sessions` directory, its `*.lock` directories, `crashes.json` and the
  status footer's usage record `consumption.json`. This stops copies into synced folders such as iCloud
  Drive and blocks changes to Git hooks and config that host Git would later run.
- Reads stay open. Credentials, including Pi's `auth.json`, are readable, but
  nothing can send them anywhere.

Pi's own command sandbox recognises the inherited profile through
`PI_COMMAND_SANDBOX_EGRESS=local-model` and runs Bash under it instead of
nesting a second profile, which macOS refuses.

## Start

Prerequisites:

- macOS, with `bun` and `pi` on `PATH`.
- The Gemma server from `local-models/gemma/`, already downloaded and
  running on port 8080.
- The `local/gemma-4-12b` provider in `~/.pi/agent/models.json`, as described
  in `local-models/gemma/README.md`. Its `baseUrl` must use the IP address
  `127.0.0.1`, because name lookups are blocked.

From the project directory, run:

```bash
~/coding-harness/local-models/confidential/start.sh
```

Pi's working directory is the only checkout it can write to, so start it from
the repository root.

In Paseo, choose the **Pi (confidential)** provider. `paseo/config.json`
defines it with `extends: "pi"` and this launcher as its command, and it
assumes this checkout is at `~/coding-harness`. Paseo appends its own Pi
arguments, including `--model`. The provider exposes only Gemma and disables
Paseo's agent tools, so a confidential agent cannot start an unconfined agent
and pass data to it.

## Unavailable in this mode

- Remote models. Selecting one with `/model` fails because its requests are blocked.
- Subagents and reviews routed to remote models.
- Web research and fetching.
- Package installs and updates (npm, PyPI, Pi packages), and Git fetch, pull and push.
- MCP servers that need the network or Docker, such as SonarQube. Its
  start-up warning is expected.
- Writing outside the checkout. Pi's `settings.json` and `trust.json` stay
  read-only, so `/settings` changes and "trust this project" answers are not
  saved. Those two files decide what a later, unconfined Pi loads and runs.
  The sandbox extension also skips tightening file permissions in
  `~/.pi/agent`; the next ordinary Pi session does it.

If something fails with `EPERM` or `Operation not permitted`, list the paths
the profile denied while you reproduce it:

```bash
log stream --style compact --predicate 'sender == "Sandbox"'
```

Residual gaps:

- Inbound connections are not restricted. A command can start a listener on all
  interfaces that another host on the network could connect to and read from;
  only the macOS firewall stands in the way. A Seatbelt `network-bind` rule
  limited to loopback still allowed binding `0.0.0.0` when measured.
- Other system daemons reached through Mach services, such as the pasteboard
  with Universal Clipboard, may carry data off the machine (unverified).
- Files written in the checkout leave with the next manual `git push`; review
  changes before pushing from an unconfined terminal.

## Paseo outside the Pi process

The Paseo daemon itself is not confined. Two Paseo paths matter:

- Workspace and branch names and generated commit and pull-request messages
  are produced from the first prompt or the diff by
  `agents.metadataGeneration`. That setting is daemon-wide and has no per-provider
  switch, so it is set to local Gemma for every session. The first naming
  request of a new workspace can take about a minute.
- The relay to the mobile and web apps is end-to-end encrypted. The relay server
  sees only metadata such as timing and message size.

## Verify

`bun test pi/agent/extensions/sandbox/kernel-sandbox.test.ts`, run from an
unconfined terminal, checks the profile itself. Connections to the model port
succeed. Connections to another localhost port, port 6767 and an external
address fail, and so do name lookups and writes outside the allowed roots.
Inside a Pi session, those checks are skipped, because macOS cannot apply the
profile within the command sandbox.
