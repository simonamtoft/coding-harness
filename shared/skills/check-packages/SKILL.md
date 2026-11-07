---
name: check-packages
description: Check that third-party packages exist, are current, not deprecated, and free of known advisories before adding or upgrading them. Use whenever you are about to add, upgrade, or recommend an npm, PyPI, Go, Maven, Cargo, NuGet, or RubyGems package.
---

# Check packages

Run the checker on every package you intend to add or upgrade, before installing it:

```bash
python3 scripts/check_packages.py npm:chrono-node pypi:httpx@0.28.1 go:github.com/spf13/cobra
```

Run `scripts/` by absolute path under this skill's directory; never `cd` into it. Specs are `ECOSYSTEM:NAME[@VERSION]` with `npm`, `pypi`, `go`, `maven` (`group:artifact`), `cargo`, `nuget`, or `rubygems`. Without a version, the script checks the registry's default version. Take names from the project's documentation or the package's official docs, never from memory.

## Reading the result

| Status | Meaning | Action |
| --- | --- | --- |
| `OK` | Package and version exist; no advisory, deprecation, or fresh-release flag | Still confirm the publisher (below) |
| `FLAGGED` | Lines marked `!`: advisories, deprecation, a yanked or unlisted version, or a release under 7 days old | Report the flags; choose another version or package, or ask the user to accept the risk |
| `NOT_FOUND` | No such package or version publicly | Stop. Check for a typo or a hallucinated name; do not try lookalikes |
| `UNCHECKED` | A lookup failed, including GitHub's limit of 60 advisory lookups per hour | Stop and report it. Do not describe the package as safe or advisory-free |
| `SKIPPED` | Scoped npm name (`@scope/name`) not sent | Rerun with `--public` only if the user or project confirms the package is public |

The script exits non-zero unless every package is `OK`.

## What it cannot judge

- **Publisher identity.** The source URL comes from unverified registry metadata; for NuGet and Maven it may be a project homepage rather than a repository. Check that it matches the repository the project's docs, or the library's official site, name as the source.
- **Lookalikes.** A package can exist and be clean yet be a typosquat. Treat a recent first-publish date, an unfamiliar or missing source repo, or a name one edit away from a well-known package as reasons to investigate before adopting.
- **Transitive dependencies and licence compatibility.** The script checks only the named packages.

## Privacy

Every queried name goes to that package's public registry (npm, PyPI, the Go module proxy, Maven Central, crates.io, NuGet, or RubyGems). Go, Maven, Cargo, NuGet, and RubyGems names also go to the GitHub Advisory Database. The Go module proxy also fetches an unknown module from its source host, so the script only sends Go modules on a fixed list of public hosts (github.com, golang.org, k8s.io and similar) and reports others `UNCHECKED`. In a Pi session, run the script as a plain `python3 <absolute path> <specs>` command with nothing chained, or Go lookups cannot reach the module proxy. Only scoped npm names are skipped automatically. Do not pass any other private or client-internal name, such as a Go module on a private host or one matching `GOPRIVATE`, a package from a private PyPI or NuGet index, or the organisation's own Maven `groupId`. `--public` overrides the scoped-name guard and nothing else.
