#!/bin/sh
# Runs as root before any agent: apply the egress firewall, reset the paseo user's home to the
# image's copy, reconnect the few paths that persist, link the read-only Pi setup, then hand
# over to Paseo's own entrypoint, which drops to the paseo user.
set -eu
/usr/local/sbin/paseo-box-firewall

home=/home/paseo
state=/var/lib/paseo-box          # volume: Pi sign-in, Pi sessions, Paseo state
harness=$home/coding-harness
host_pi=$home/.config/paseo-box-host
agent_dir=$home/.pi/agent

# Anything an agent wrote into the home directory (Pi's agent directory, ~/.agents/skills, shell
# startup files) would load into later sessions, so the home directory starts fresh every time.
# The read-only mounts are left alone.
find "$home" -mindepth 1 -maxdepth 1 ! -name coding-harness ! -name pi-plugins ! -name .config -exec rm -rf {} +
find "$home/.config" -mindepth 1 -maxdepth 1 ! -name paseo-box-host -exec rm -rf {} +
cp -a /opt/paseo-home-skel/. "$home/"

install -d -o paseo -g paseo -m 700 "$state/pi" "$state/pi/sessions" "$state/paseo"
[ -e "$state/pi/auth.json" ] || install -o paseo -g paseo -m 600 /dev/null "$state/pi/auth.json"
gosu paseo mkdir -p "$agent_dir"
gosu paseo ln -s "$state/pi/auth.json" "$agent_dir/auth.json"
gosu paseo ln -s "$state/pi/sessions" "$agent_dir/sessions"
gosu paseo ln -s "$state/paseo" "$home/.paseo"

# models.json stays read-only for agents; settings.json is a writable copy, because Pi records
# state such as the last changelog version in it.
gosu paseo ln -s "$host_pi/models.json" "$agent_dir/models.json"
gosu paseo cp "$host_pi/settings.json" "$agent_dir/settings.json"
gosu paseo "$harness/link.sh" --packages

exec /usr/local/bin/paseo-docker-entrypoint "$@"
