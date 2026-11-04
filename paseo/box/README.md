# paseo-box

paseo-box runs a second Paseo daemon, with Pi and this repository's Pi setup, inside a Linux container on Colima. Agents started on that host work on one mounted checkout behind a default-deny egress firewall. Use it for unattended or untrusted agent runs. The host Paseo daemon remains the default for everything else.

The Pi sandbox extension inspects tool calls but is not an OS boundary ([SBX-13](../../decisions/sandbox.md)). The box adds a real boundary: the container sees only what is mounted, and its network is limited to an allowlist. Decisions and refused alternatives are recorded in [SBX-33 to SBX-36](../../decisions/sandbox.md); the investigation is PI-26.

```text
Mac
├── Paseo app ──── 127.0.0.1:6767 ──▶ host daemon (unchanged)
│             └─── 127.0.0.1:6768 ──▶ Colima VM ─▶ container "paseo-box"
│                                       ├── firewall (root, at start)
│                                       ├── Paseo daemon 0.15.0 + Pi 1.4.0 (user paseo)
│                                       └── mounts:
├── ~/coding-harness ...................... /home/paseo/coding-harness   read-only
├── ~/pi-plugins .......................... /home/paseo/pi-plugins       read-only
├── ~/.config/paseo-box/pi ................ models.json, settings.json    read-only copies
└── <checkout> ............................ /workspace                   read-write
    └── .git .............................. read-only
```

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Paseo's image plus Pi, uv, Python 3.12, go-task, Bun and the firewall tools. Versions match the Mac. |
| `firewall.sh` | Default-deny egress, applied as root before any agent runs. |
| `entrypoint.sh` | Applies the firewall, links the Pi setup with `link.sh --packages`, then starts Paseo as `paseo`. |
| `compose.yaml` | Mounts, published port and environment. Start it through the launcher. |
| `paseo-box.sh` | Launcher: refreshes the local Pi files, creates the daemon password, starts the box on a checkout. |

Nothing generated or secret is tracked. The launcher keeps its state in `~/.config/paseo-box/`.

## Prerequisites

- Colima, with the Docker CLI and its `compose` and `buildx` plugins. Docker Desktop's CLI works; without Docker Desktop, install `docker`, `docker-compose` and `docker-buildx` from Homebrew.
- `IM_GPT_API_KEY` and `HETZNER_API_KEY` exported in the shell that runs the launcher, if you use those providers.
- `~/.pi/agent/models.json` and `~/.pi/agent/settings.json` on the Mac (see the root README).

## First-time setup

1. Create the folder the box reads your local Pi files from:

   ```sh
   mkdir -p ~/.config/paseo-box/pi
   ```

2. Start Colima with exactly these mounts. A mount without `:w` is read-only. `colima start --mount` replaces the whole list, so always pass all of them; add other checkout roots the same way.

   ```sh
   colima start --vm-type vz --mount-type virtiofs --vz-rosetta --cpus 4 --memory 6 \
     --mount ~/projects:w --mount ~/coding-harness --mount ~/pi-plugins --mount ~/.config/paseo-box/pi
   ```

   Do not mount `~/.pi/agent`, `~/.ssh`, `~/.config/paseo-box` itself or your whole home directory.

3. Start the box on a checkout. With no argument the launcher uses the Git checkout containing the current directory:

   ```sh
   ~/coding-harness/paseo/box/paseo-box.sh ~/projects/<repo>
   ```

   The first build downloads the base image and tools and takes a few minutes; later starts reuse the image and take seconds.

4. Sign Pi in to Anthropic inside the box. The sign-in is stored in the box's state volume and is separate from the Mac's:

   ```sh
   docker --context colima exec -it --user paseo paseo-box pi
   ```

   Run `/login`, choose Anthropic and then **Copy code login (headless)**. Open the printed URL on the Mac and paste the code back into Pi, then quit Pi. The browser login does not work, because its callback to `localhost` on the Mac cannot reach Pi in the box.

5. In Paseo, open **Settings → Add host → Direct connection** and enter `127.0.0.1:6768`. The password is in `~/.config/paseo-box/daemon-pass`.

## Daily use

- **Switch checkout:** run the launcher on another checkout. Compose recreates the container in a few seconds; the Pi sign-in, Paseo state and sessions stay in the volume. One checkout is served at a time.
- **Refresh local Pi files or API keys:** run the launcher again. `models.json` and `settings.json` are copied on every start, and keys are read from the launching shell.
- **Stop:** `docker --context colima stop paseo-box`, then `colima stop` if nothing else needs it. Run the launcher again to start; it refreshes the local Pi files.
- **Docker context:** the launcher always targets Colima explicitly. `colima start` makes `colima` the active context and `colima stop` leaves `default` active; run `docker context use desktop-linux` to return to Docker Desktop.

The box works on the checkout's current branch. File changes appear on the Mac immediately, and anything you change on the Mac is visible to the agent.

### Git and Paseo worktrees

`.git` is read-only in the box, because Git on the Mac executes what that directory says: a hook, a `core.fsmonitor` setting, or a `commondir` file that redirects Git to config the agent wrote. Agents can read history and diffs, but cannot commit, create branches, stash or update the index. Review their changes and commit on the Mac, or from a workspace on the host Paseo daemon.

For the same reason, use local workspaces on the box host. Paseo worktree workspaces fail there, because creating one writes to `.git`. Create worktrees on the host daemon when you need them.

The launcher needs a main checkout. It refuses a linked worktree, whose Git data lives outside the checkout. Git on the Mac picks up the box's file changes as ordinary working-tree edits; after changing remotes or branches on the Mac, the box sees them at once.

## Boundaries and policy

| Resource | Inside the box |
| --- | --- |
| Mounted checkout | Working tree read-write; `.git` read-only. |
| `coding-harness` | Read-only. Agents cannot change their own instructions, extensions or `link.sh`. |
| Home directory | Reset as root on every start from the image's copy, so files an agent plants there (Pi's agent directory, `~/.agents/skills`, shell startup files) do not reach later sessions. Only the Pi sign-in, Pi sessions and Paseo's state persist, in the `paseo-box_paseo-box-state` volume. `/tmp` is a 2 GB in-memory tmpfs that is emptied on every restart. |
| Mac Pi files | Read-only copies of `models.json` and `settings.json`. `settings.json` is copied to a writable file at each start; `models.json` stays read-only. `auth.json`, `trust.json` and sessions are not copied. |
| Credentials | The box's own Pi sign-in, `IM_GPT_API_KEY`, `HETZNER_API_KEY`, any literal keys in `models.json`, and the daemon password, which Paseo passes in the environment. No SSH keys, Git credentials, cloud CLI config, keychain or Docker socket. |
| Network out | Docker's embedded DNS (outside resolvers are blocked), GitHub's published ranges, and the hosts in `firewall.sh` plus every non-loopback `baseUrl` host in `models.json`. `pi.dev` is allowed for Pi's model catalogs; without it `/model` reports `Could not refresh anthropic` and Pi lacks models newer than its bundled list. Everything else is rejected; IPv6 is loopback only. |
| Mac and Colima services | Blocked. Tested 2026-11-04: an unfirewalled container reached a server on the Mac's loopback (through `host.docker.internal`, 192.168.5.2), one on the Mac's LAN address, and a port another Colima container published (through the VM gateway and through 192.168.5.2). From the box all of these probes are rejected. The firewall accepts only incoming connections from the box's own Docker network, because outgoing ones would reach the VM gateway, where every container's published ports listen. |
| Network in | Only Paseo's port, published on the Mac's loopback and protected by the daemon password. The password keeps other Mac processes out; agents in the box can read it and drive their own daemon, including answering their own question cards. Relay is off for the box. |
| Privilege | Agents, Paseo terminals and workspace setup hooks all run inside the box as `paseo`, with no `sudo`. The container drops all Linux capabilities except the seven that root's start-up needs: `NET_ADMIN` and `NET_RAW` for the firewall, `CHOWN`, `DAC_OVERRIDE` and `FOWNER` to reset the home directory, and `SETUID` and `SETGID` for `gosu`. Start-up fails without any one of them. Root hands over before agents start, so agent processes hold no capabilities, and `no-new-privileges` stops setuid binaries from regaining any. |

Known limits:

- Anything the agent can read can still be sent to an allowed host. GitHub is allowed as a whole, so a token with push access could publish data to any repository it reaches.
- Docker's embedded resolver forwards lookups for any name, so data can still leak slowly through DNS queries.
- An agent can create a nested repository (`some/dir/.git`) in the working tree. Git on the Mac does not read a nested repository's config from the outer checkout, but running Git inside that directory would; delete unexpected nested `.git` directories before using them.
- Paseo's state persists across starts and checkouts, so a Paseo plugin or setting an agent adds through the daemon stays until you remove it. Pi's own setup does not persist: the entrypoint relinks it from the read-only harness every start, and refuses to start if `~/.paseo/config.json` points anywhere else.
- Allowed hosts are resolved to IP addresses at start. A CDN that changes addresses later breaks until the next start; restart the box.
- `.env` files in the checkout are readable by the agent.
- Agents can still change files that you later run on the Mac, such as `Taskfile.yml`, `package.json` scripts or `.envrc`. Review the diff before running project commands on the Mac.
- Providers whose `baseUrl` points at the Mac's loopback (`local`, `bonsai-local`) are unreachable from the box, as are all other Mac and Colima services. An allowed address opens all its ports, so the firewall refuses to start if an allowed host, a provider host or `PASEO_BOX_EXTRA_HOSTS` resolves to a private address (loopback, RFC 1918, link-local or 100.64.0.0/10). `host.docker.internal`, for example, would open every port on the Mac's loopback, including the host Paseo daemon. A provider on a private network therefore cannot be used from the box.

### Extending the allowlist

For a one-off host, export `PASEO_BOX_EXTRA_HOSTS="host1 host2"` before running the launcher. For a permanent host, add it to `fixed_hosts` in `firewall.sh` and rebuild by running the launcher. Provider hosts come from `models.json` automatically.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Colima is not running` | Start Colima with the mounts above. |
| `context "colima": context not found` | Colima removes its Docker context when it stops; start Colima. |
| Mount errors or missing files under `/home/paseo` | A path is missing from Colima's mount list; restart Colima with the full list. |
| Container exits at start | `docker --context colima logs paseo-box`; a firewall line names the host it could not resolve. |
| A tool cannot download something | Find the host in its error and extend the allowlist. |
| Git reports `dubious ownership` | The checkout is not mounted at `/workspace`; start the box through the launcher. |
| Pi models missing in the box | Check `~/.pi/agent/models.json` on the Mac and that the API keys were exported in the launching shell. |

Run the harness load check inside the box after changing the Pi setup:

```sh
docker --context colima exec --user paseo --workdir /home/paseo/coding-harness paseo-box bun scripts/pi-load-check.ts
```

## Removal

```sh
docker --context colima rm -f paseo-box
docker --context colima volume rm paseo-box_paseo-box-state  # Pi sign-in, Pi sessions and Paseo state
docker --context colima image rm paseo-box:local
rm -rf ~/.config/paseo-box
colima delete                                                # only if nothing else uses Colima
```

Then remove the host in Paseo's settings.
