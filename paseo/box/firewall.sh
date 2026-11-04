#!/bin/bash
# Default-deny egress for paseo-box. Runs as root at container start, before any agent process.
# Allowed out: loopback (which carries Docker's embedded DNS at 127.0.0.11), replies to allowed
# traffic, GitHub's published ranges, and the hosts below resolved at start. No port is open to
# arbitrary hosts, including 53. Allowed in: the container's own network, which carries
# connections to Paseo's published port. New outbound connections to that network stay blocked,
# because its gateway is the Colima VM, where every container's published ports listen.
set -euo pipefail

host_pi=/home/paseo/.config/paseo-box-host
fixed_hosts=(
  api.anthropic.com claude.ai platform.claude.com console.anthropic.com  # Pi's Anthropic provider and sign-in
  pi.dev                                                                 # Pi's model catalogs
  registry.npmjs.org                                                     # Pi packages, npm installs
  pypi.org files.pythonhosted.org                                        # uv
  imcg.ghe.com                                                           # Implement GitHub Enterprise
  openaipublic.blob.core.windows.net                                     # tiktoken encodings
)

model_hosts() {
  # Provider hosts from the Mac's models.json; loopback providers run on the Mac and stay unreachable.
  jq -r '.providers[]?.baseUrl // empty' "$host_pi/models.json" 2>/dev/null \
    | sed -E 's#^[a-zA-Z]+://([^/:]+).*#\1#' \
    | grep -vE '^(localhost|127\.|0\.0\.0\.0$|\[?::1)' || true
}

# Docker's embedded DNS (127.0.0.11) lives in the nat table; keep its rules across the flush.
docker_dns_nat=$(iptables-save -t nat | grep -F '127.0.0.11' || true)
for table in filter nat mangle; do
  iptables -t "$table" -F
  iptables -t "$table" -X
done
if [[ -n "$docker_dns_nat" ]]; then
  iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
  iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
  while IFS= read -r rule; do
    read -ra args <<<"$rule"
    iptables -t nat "${args[@]}"
  done <<<"$docker_dns_nat"
fi

ipset destroy paseo-box-allowed 2>/dev/null || true
ipset create paseo-box-allowed hash:net

github_meta=$(curl -fsS --max-time 15 https://api.github.com/meta)
jq -r '(.web + .api + .git)[] | select(test(":") | not)' <<<"$github_meta" | aggregate -q \
  | while read -r cidr; do ipset add -exist paseo-box-allowed "$cidr"; done

# Loopback, RFC 1918, link-local and carrier-grade NAT (100.64.0.0/10).
private_ipv4='^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)'
# shellcheck disable=SC2207 # host names contain no whitespace
extra_hosts=($(model_hosts) ${PASEO_BOX_EXTRA_HOSTS:-})
for host in "${fixed_hosts[@]}" "${extra_hosts[@]}"; do
  addresses=$(dig +short A "$host" | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)
  if [[ -z "$addresses" ]]; then
    echo "paseo-box firewall: cannot resolve $host" >&2
    exit 1
  fi
  # An allowed address opens every port on it, so a host resolving to the Mac (host.docker.internal),
  # the VM gateway or anything else private would undo the Mac and Colima block.
  for address in $addresses; do
    if [[ "$address" =~ $private_ipv4 ]]; then
      echo "paseo-box firewall: refusing $host, which resolves to private address $address" >&2
      exit 1
    fi
    ipset add -exist paseo-box-allowed "$address"
  done
  echo "paseo-box firewall: allowing $host"
done

own_network=$(ip -o -4 route show scope link | awk 'NR == 1 {print $1}')
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -s "$own_network" -j ACCEPT
iptables -A OUTPUT -m set --match-set paseo-box-allowed dst -j ACCEPT
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP
# IPv6: loopback only. Without ip6tables, refuse to start if the container has a routable IPv6 address.
if ip6tables -F 2>/dev/null; then
  ip6tables -A INPUT -i lo -j ACCEPT
  ip6tables -A OUTPUT -o lo -j ACCEPT
  ip6tables -P INPUT DROP
  ip6tables -P OUTPUT DROP
  ip6tables -P FORWARD DROP
elif [[ -n "$(ip -6 addr show scope global 2>/dev/null)" ]]; then
  echo "paseo-box firewall: cannot restrict IPv6, and the container has a global IPv6 address" >&2
  exit 1
fi

if curl -fsS --max-time 5 -o /dev/null https://example.com; then
  echo "paseo-box firewall: self-test failed, example.com is reachable" >&2
  exit 1
fi
if ! curl -fsS --max-time 10 -o /dev/null https://api.github.com/zen; then
  echo "paseo-box firewall: self-test failed, api.github.com is unreachable" >&2
  exit 1
fi
echo "paseo-box firewall: active (self-test passed)"
