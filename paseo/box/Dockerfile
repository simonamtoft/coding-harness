# paseo-box: the Paseo daemon and Pi, with the coding-harness setup, behind a default-deny egress firewall.
# Versions match the Mac so the box behaves like the host; update them together.
FROM ghcr.io/getpaseo/paseo:0.15.0

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      iptables ipset iproute2 dnsutils aggregate jq git curl ca-certificates unzip \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Mounted checkouts are owned by the Mac user, not paseo; without this Git refuses them.
RUN git config --system --add safe.directory /workspace \
  && git config --system --add safe.directory /home/paseo/coding-harness

# /home/paseo is a volume, so tools live outside it; the throwaway cache keeps root-owned files out of it.
COPY --from=ghcr.io/astral-sh/uv:0.10.8 /uv /uvx /usr/local/bin/
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python UV_LINK_MODE=copy
RUN UV_CACHE_DIR=/tmp/uv-build-cache uv python install 3.12 \
  && rm -rf /tmp/uv-build-cache && chmod -R a+rX /opt/uv-python
RUN sh -c "$(curl -fsSL https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
RUN npm install -g @earendil-works/pi-coding-agent@1.4.0
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s bun-v1.4.2

# The entrypoint restores the home directory from this copy on every start.
RUN cp -a /home/paseo /opt/paseo-home-skel

# The firewall runs as root before Paseo's entrypoint drops to the paseo user, so the image
# needs no sudo rule and the agent user cannot change the rules.
COPY firewall.sh /usr/local/sbin/paseo-box-firewall
COPY entrypoint.sh /usr/local/sbin/paseo-box-entrypoint
RUN chmod 0755 /usr/local/sbin/paseo-box-firewall /usr/local/sbin/paseo-box-entrypoint
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/sbin/paseo-box-entrypoint"]
