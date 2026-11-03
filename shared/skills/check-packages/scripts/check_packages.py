#!/usr/bin/env python3
"""Check packages against public registry metadata and advisories before adding or upgrading them.

Usage: check_packages.py [--public] ECOSYSTEM:NAME[@VERSION] ...

Metadata comes from deps.dev and advisories from OSV; both are Google services, so every
queried name leaves the machine. Scoped npm names (@scope/name) are skipped unless
--public is passed, because they are the common shape of private or client-internal
packages. Without a version, the registry's default version is checked.

Exit status is 0 only when every package is OK. A lookup failure reports UNCHECKED,
never a clean result.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone

DEPS_DEV = "https://api.deps.dev/v3/systems"
OSV_QUERY = "https://api.osv.dev/v1/query"
RECENT_RELEASE_DAYS = 7
TIMEOUT_SECONDS = 15

# Ecosystem argument -> (deps.dev system, OSV ecosystem).
ECOSYSTEMS = {
    "npm": ("npm", "npm"),
    "pypi": ("pypi", "PyPI"),
    "go": ("go", "Go"),
    "maven": ("maven", "Maven"),
    "cargo": ("cargo", "crates.io"),
    "nuget": ("nuget", "NuGet"),
    "rubygems": ("rubygems", "RubyGems"),
}


class NotFound(Exception):
    pass


class LookupFailed(Exception):
    pass


def fetch_json(url: str, body: dict | None = None) -> dict:
    # curl rather than urllib: Homebrew and python.org Pythons on macOS often ship without a CA
    # bundle, while curl uses the system trust store.
    command = ["curl", "-sS", "--max-time", str(TIMEOUT_SECONDS), "-w", "\n%{http_code}", url]
    if body is not None:
        command += ["-H", "Content-Type: application/json", "--data-binary", json.dumps(body)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as error:
        raise LookupFailed(f"cannot run curl: {error}") from error
    payload, _, status = result.stdout.rpartition("\n")
    if result.returncode != 0:
        raise LookupFailed(f"{url}: {result.stderr.strip() or f'curl exit {result.returncode}'}")
    if status == "404":
        raise NotFound(url)
    if status != "200":
        raise LookupFailed(f"HTTP {status} from {url}")
    try:
        return json.loads(payload)
    except json.JSONDecodeError as error:
        raise LookupFailed(f"{url}: invalid JSON: {error}") from error


@dataclass(frozen=True)
class Spec:
    ecosystem: str
    name: str
    version: str | None

    def __str__(self) -> str:
        return f"{self.ecosystem}:{self.name}" + (f"@{self.version}" if self.version else "")


def parse_spec(text: str) -> Spec:
    ecosystem, sep, rest = text.partition(":")
    if not sep or ecosystem.lower() not in ECOSYSTEMS or not rest:
        raise argparse.ArgumentTypeError(
            f"{text!r}: expected ECOSYSTEM:NAME[@VERSION] with ECOSYSTEM in {', '.join(ECOSYSTEMS)}")
    # A leading "@" belongs to an npm scope, not a version separator.
    at = rest.rfind("@")
    if at > 0:
        name, version = rest[:at], rest[at + 1:]
        if not version:
            raise argparse.ArgumentTypeError(f"{text!r}: empty version after '@'")
    else:
        name, version = rest, None
    return Spec(ecosystem.lower(), name, version)


@dataclass
class Report:
    spec: Spec
    status: str = "OK"
    lines: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)

    def render(self) -> str:
        status = "FLAGGED" if self.status == "OK" and self.flags else self.status
        out = [f"{status}  {self.spec}"]
        out += [f"  {line}" for line in self.lines]
        out += [f"  ! {flag}" for flag in self.flags]
        return "\n".join(out)

    @property
    def ok(self) -> bool:
        return self.status == "OK" and not self.flags


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _osv_advisories(osv_ecosystem: str, name: str, version: str) -> list[str]:
    ids: list[str] = []
    body: dict = {"package": {"name": name, "ecosystem": osv_ecosystem}, "version": version}
    while True:
        try:
            result = fetch_json(OSV_QUERY, body)
        except NotFound as error:
            raise LookupFailed(f"OSV query endpoint not found: {error}") from error
        ids += [vuln["id"] for vuln in result.get("vulns", [])]
        token = result.get("next_page_token")
        if not token:
            return ids
        body = {**body, "page_token": token}


def check(spec: Spec, now: datetime) -> Report:
    report = Report(spec)
    system, osv_ecosystem = ECOSYSTEMS[spec.ecosystem]
    package_url = f"{DEPS_DEV}/{system}/packages/{urllib.parse.quote(spec.name, safe='')}"
    try:
        package = fetch_json(package_url)
    except NotFound:
        report.status = "NOT_FOUND"
        report.lines.append("no such package in the public registry; check the name for typos or lookalikes")
        return report

    canonical = package["packageKey"]["name"]
    versions = package.get("versions", [])
    published = [_parse_time(v["publishedAt"]) for v in versions if v.get("publishedAt")]
    if published:
        report.lines.append(f"package first published {min(published).date()}")
    if canonical != spec.name:
        report.lines.append(f"registry name: {canonical}")

    default = next((v["versionKey"]["version"] for v in versions if v.get("isDefault")), None)
    version = spec.version or default
    if version is None:
        report.status = "UNCHECKED"
        report.lines.append("registry reports no default version; pass an explicit version")
        return report

    try:
        detail = fetch_json(f"{package_url}/versions/{urllib.parse.quote(version, safe='')}")
    except NotFound:
        report.status = "NOT_FOUND"
        report.lines.append(f"version {version} does not exist")
        return report

    if version == default:
        report.lines.append(f"version {version} (registry default)")
    else:
        report.lines.append(f"version {version}; registry default is {default or 'unknown'}")
    if detail.get("publishedAt"):
        released = _parse_time(detail["publishedAt"])
        age_days = (now - released).days
        report.lines.append(f"released {released.date()} ({age_days} days ago)")
        if age_days < RECENT_RELEASE_DAYS:
            report.flags.append(f"released under {RECENT_RELEASE_DAYS} days ago; scrutinize before adopting")
    if detail.get("isDeprecated"):
        report.flags.append(f"deprecated: {detail.get('deprecatedReason') or 'no reason given'}")

    repos = [link["url"] for link in detail.get("links", []) if link.get("label") == "SOURCE_REPO"]
    report.lines.append("source repo (unverified): " + (", ".join(repos) if repos else "none listed"))
    report.lines.append("licenses: " + (", ".join(detail.get("licenses", [])) or "none listed"))
    if detail.get("attestations") or detail.get("slsaProvenances"):
        report.lines.append("has registry attestations or SLSA provenance")

    advisories = _osv_advisories(osv_ecosystem, canonical, version)
    if advisories:
        report.flags.append("advisories: " + ", ".join(sorted(set(advisories))))
    else:
        report.lines.append(f"no OSV advisories for {version} as of {now.date()}")
    return report


def run(specs: list[Spec], allow_public_scoped: bool, now: datetime) -> list[Report]:
    reports = []
    for spec in specs:
        if spec.ecosystem == "npm" and spec.name.startswith("@") and not allow_public_scoped:
            report = Report(spec, status="SKIPPED")
            report.lines.append("scoped npm name not sent to deps.dev/OSV; rerun with --public if it is public")
            reports.append(report)
            continue
        try:
            reports.append(check(spec, now))
        except (LookupFailed, KeyError, ValueError, TypeError) as error:
            report = Report(spec, status="UNCHECKED")
            report.lines.append(f"lookup failed, so nothing about this package is verified: {error}")
            reports.append(report)
    return reports


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--public", action="store_true", help="also query scoped npm names")
    parser.add_argument("packages", nargs="+", type=parse_spec, metavar="ECOSYSTEM:NAME[@VERSION]")
    args = parser.parse_args(argv)
    reports = run(args.packages, args.public, datetime.now(timezone.utc))
    print("\n\n".join(report.render() for report in reports))
    return 0 if all(report.ok for report in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
