#!/usr/bin/env python3
"""Check packages against public registry metadata and advisories before adding or upgrading them.

Usage: check_packages.py [--public] ECOSYSTEM:NAME[@VERSION] ...

Metadata comes from each package's own public registry. Advisories come from npm's advisory
endpoint for npm, PyPI's vulnerability data for PyPI, and the GitHub Advisory Database for the
other ecosystems. Every queried name leaves the machine. Scoped npm names (@scope/name) are
skipped unless --public is passed, because they are the common shape of private or
client-internal packages. Without a version, the registry's default version is checked.

Exit status is 0 only when every package is OK. A lookup failure reports UNCHECKED,
never a clean result.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.parse
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

NPM = "https://registry.npmjs.org"
PYPI = "https://pypi.org/pypi"
GO_PROXY = "https://proxy.golang.org"
MAVEN_CENTRAL = "https://repo1.maven.org/maven2"
CRATES = "https://crates.io/api/v1/crates"
NUGET_REGISTRATION = "https://api.nuget.org/v3/registration5-gz-semver2"
RUBYGEMS = "https://rubygems.org/api/v1"
GITHUB_API = "https://api.github.com"
RECENT_RELEASE_DAYS = 7
TIMEOUT_SECONDS = 30
# crates.io refuses requests without an identifying User-Agent.
USER_AGENT = "check-packages (coding-harness)"
WRITE_OUT_MARKER = "\n--check-packages-status--"

ECOSYSTEMS = ("npm", "pypi", "go", "maven", "cargo", "nuget", "rubygems")
MAVEN_COORDINATE = re.compile(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*:[A-Za-z0-9_.-]+")


class NotFound(Exception):
    pass


class LookupFailed(Exception):
    pass


class Missing(Exception):
    """The registry has no such package or version; the message is the report line."""

    @classmethod
    def package(cls, kind: str) -> "Missing":
        return cls(f"no such {kind} in the public registry; check the name for typos or lookalikes")

    @classmethod
    def version(cls, version: str, hint: str = "") -> "Missing":
        return cls(f"version {version} does not exist{hint}")


@dataclass(frozen=True)
class Response:
    text: str
    last_modified: str
    link: str


def fetch(url: str, body: dict | None = None) -> Response:
    # curl rather than urllib: Homebrew and python.org Pythons on macOS often ship without a CA
    # bundle, while curl uses the system trust store.
    write_out = WRITE_OUT_MARKER + "%{http_code}\t%header{last-modified}\t%header{link}"
    command = ["curl", "-sS", "--compressed", "--max-time", str(TIMEOUT_SECONDS), "-A", USER_AGENT,
               "-w", write_out, url]
    if body is not None:
        command += ["-H", "Content-Type: application/json", "--data-binary", json.dumps(body)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as error:
        raise LookupFailed(f"cannot run curl: {error}") from error
    if result.returncode != 0:
        raise LookupFailed(f"{url}: {result.stderr.strip() or f'curl exit {result.returncode}'}")
    payload, _, trailer = result.stdout.rpartition(WRITE_OUT_MARKER)
    status, last_modified, link = (trailer.split("\t") + ["", ""])[:3]
    if status in ("404", "410"):
        raise NotFound(url)
    if status in ("403", "429") and url.startswith(GITHUB_API):
        raise LookupFailed(f"HTTP {status} from {url}: GitHub allows 60 unauthenticated requests per hour; retry later")
    if status != "200":
        raise LookupFailed(f"HTTP {status} from {url}")
    return Response(payload, last_modified, link)


def fetch_json(url: str, body: dict | None = None):
    text = fetch(url, body).text
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise LookupFailed(f"{url}: invalid JSON: {error}") from error


def parse_xml(url: str, text: str) -> ElementTree.Element:
    # Maven metadata and POMs never need a DTD; refusing one rules out entity-expansion payloads.
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        raise LookupFailed(f"{url}: XML with a DTD is not accepted")
    try:
        return ElementTree.fromstring(text)
    except ElementTree.ParseError as error:
        raise LookupFailed(f"{url}: invalid XML: {error}") from error


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
    if ecosystem.lower() == "maven" and not MAVEN_COORDINATE.fullmatch(name):
        raise argparse.ArgumentTypeError(f"{text!r}: Maven names are GROUP:ARTIFACT, e.g. org.slf4j:slf4j-api")
    return Spec(ecosystem.lower(), name, version)


@dataclass
class Release:
    """What one registry reports about one version, normalised across ecosystems."""
    name: str
    version: str
    default: str | None
    released: datetime | None = None
    first_published: datetime | None = None
    sources: list[str] = field(default_factory=list)
    licenses: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    advisories: list[str] = field(default_factory=list)
    advisory_source: str = "GitHub Advisory Database"


class NoDefaultVersion(Exception):
    pass


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _q(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _choose_version(spec: Spec, default: str | None) -> str:
    version = spec.version or default
    if version is None:
        raise NoDefaultVersion()
    return version


def _github_advisories(ecosystem: str, name: str, version: str) -> list[str]:
    url = f"{GITHUB_API}/advisories?ecosystem={ecosystem}&affects={_q(f'{name}@{version}')}&per_page=100"
    ids: list[str] = []
    while url:
        try:
            response = fetch(url)
        except NotFound as error:
            raise LookupFailed(f"GitHub advisory endpoint not found: {error}") from error
        advisories = json.loads(response.text)
        if not isinstance(advisories, list):
            raise LookupFailed(f"{url}: expected a list of advisories")
        ids += [advisory["ghsa_id"] for advisory in advisories if not advisory.get("withdrawn_at")]
        url = _next_link(response.link)
    return ids


def _next_link(link_header: str) -> str:
    match = re.search(r'<([^>]+)>;\s*rel="next"', link_header)
    if not match:
        return ""
    if not match.group(1).startswith(f"{GITHUB_API}/"):
        raise LookupFailed(f"unexpected pagination link: {match.group(1)}")
    return match.group(1)


def _npm(spec: Spec) -> Release:
    try:
        package = fetch_json(f"{NPM}/{urllib.parse.quote(spec.name, safe='@')}")
    except NotFound:
        raise Missing.package("package")
    default = package.get("dist-tags", {}).get("latest")
    version = _choose_version(spec, default)
    manifest = package.get("versions", {}).get(version)
    if manifest is None:
        raise Missing.version(version)
    times = package.get("time", {})
    release = Release(package["name"], version, default,
                      released=_parse_time(times[version]) if version in times else None,
                      first_published=_parse_time(times["created"]) if "created" in times else None,
                      advisory_source="npm advisory database")
    if manifest.get("deprecated"):
        release.warnings.append(f"deprecated: {manifest['deprecated']}")
    repository = manifest.get("repository")
    repository_url = repository.get("url") if isinstance(repository, dict) else repository
    release.sources = [repository_url] if repository_url else []
    license_value = manifest.get("license")
    license_name = license_value.get("type") if isinstance(license_value, dict) else license_value
    release.licenses = [license_name] if license_name else []
    found = fetch_json(f"{NPM}/-/npm/v1/security/advisories/bulk", {package["name"]: [version]})
    release.advisories = [advisory["url"].rsplit("/", 1)[-1] for advisory in found.get(package["name"], [])]
    return release


PYPI_SOURCE_LABEL = re.compile(r"source|repo|code|github|gitlab", re.IGNORECASE)


def _pypi(spec: Spec) -> Release:
    try:
        package = fetch_json(f"{PYPI}/{_q(spec.name)}/json")
    except NotFound:
        raise Missing.package("package")
    default = package["info"].get("version")
    version = _choose_version(spec, default)
    try:
        detail = fetch_json(f"{PYPI}/{_q(spec.name)}/{_q(version)}/json")
    except NotFound:
        raise Missing.version(version)
    uploads = [_parse_time(file["upload_time_iso_8601"])
               for files in package.get("releases", {}).values() for file in files]
    version_uploads = [_parse_time(file["upload_time_iso_8601"]) for file in detail.get("urls", [])]
    info = detail["info"]
    release = Release(package["info"]["name"], version, default,
                      released=min(version_uploads) if version_uploads else None,
                      first_published=min(uploads) if uploads else None,
                      advisory_source="PyPI vulnerability data")
    if info.get("yanked"):
        release.warnings.append(f"yanked: {info.get('yanked_reason') or 'no reason given'}")
    urls = info.get("project_urls") or {}
    release.sources = [url for label, url in urls.items() if PYPI_SOURCE_LABEL.search(label)]
    # Some projects paste the whole licence text into `license`; keep its first line.
    license_text = info.get("license_expression") or (info.get("license") or "").strip().split("\n")[0][:80]
    release.licenses = [license_text] if license_text else []
    vulnerabilities = detail.get("vulnerabilities")
    if not isinstance(vulnerabilities, list):
        raise LookupFailed(f"PyPI reported no vulnerability list for {spec.name} {version}")
    release.advisories = [vuln["id"] for vuln in vulnerabilities if not vuln.get("withdrawn")]
    return release


def _go_escape(path: str) -> str:
    """Module proxy case encoding: each uppercase letter becomes '!' plus its lowercase."""
    escaped = (re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), part) for part in path.split("/"))
    return "/".join(urllib.parse.quote(part, safe="!") for part in escaped)


# On a cache miss proxy.golang.org fetches the module path from its first element's host, so the script only sends
# paths on well-known public hosts; otherwise a crafted module path would relay data to any host (SBX-50).
GO_MODULE_HOSTS = frozenset({
    "github.com", "gitlab.com", "bitbucket.org", "golang.org", "google.golang.org", "cloud.google.com",
    "gopkg.in", "k8s.io", "sigs.k8s.io", "go.uber.org", "go.opentelemetry.io", "go.etcd.io", "go.mongodb.org",
    "go.temporal.io", "go.yaml.in", "gorm.io", "gocloud.dev", "gotest.tools", "honnef.co", "modernc.org",
    "mvdan.cc", "filippo.io", "connectrpc.com", "buf.build", "dario.cat", "golang.zx2c4.com",
})


def _go(spec: Spec) -> Release:
    host = spec.name.split("/", 1)[0].lower()
    if host not in GO_MODULE_HOSTS:
        raise LookupFailed(f"module host {host} is not on the script's list of public Go module hosts, so the name "
                           "was not sent to proxy.golang.org (it fetches unknown modules from that host); "
                           "verify this module manually")
    module = _go_escape(spec.name)
    try:
        latest = fetch_json(f"{GO_PROXY}/{module}/@latest")
    except NotFound:
        raise Missing.package("module")
    version = _choose_version(spec, latest.get("Version"))
    try:
        info = fetch_json(f"{GO_PROXY}/{module}/@v/{_go_escape(version)}.info")
    except NotFound:
        raise Missing.version(version)
    release = Release(spec.name, info["Version"], latest.get("Version"),
                      released=_parse_time(info["Time"]) if info.get("Time") else None)
    origin = info.get("Origin", {}).get("URL")
    release.sources = [origin] if origin else []
    release.advisories = _github_advisories("go", spec.name, release.version)
    return release


def _local(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ElementTree.Element, *path: str) -> list[ElementTree.Element]:
    found = [element]
    for name in path:
        found = [child for parent in found for child in parent if _local(child) == name]
    return found


def _text(element: ElementTree.Element, *path: str) -> str | None:
    found = _children(element, *path)
    if not found:
        return None
    return (found[0].text or "").strip() or None


def _maven(spec: Spec) -> Release:
    group, artifact = spec.name.split(":")
    base = f"{MAVEN_CENTRAL}/{'/'.join(group.split('.'))}/{artifact}"
    try:
        metadata_url = f"{base}/maven-metadata.xml"
        metadata = parse_xml(metadata_url, fetch(metadata_url).text)
    except NotFound:
        raise Missing.package("artifact")
    default = _text(metadata, "versioning", "release") or _text(metadata, "versioning", "latest")
    version = _choose_version(spec, default)
    if version not in [(v.text or "").strip() for v in _children(metadata, "versioning", "versions", "version")]:
        raise Missing.version(version)
    pom_url = f"{base}/{_q(version)}/{artifact}-{_q(version)}.pom"
    try:
        pom_response = fetch(pom_url)
    except NotFound:
        raise Missing.version(version)
    pom = parse_xml(pom_url, pom_response.text)
    released = parsedate_to_datetime(pom_response.last_modified) if pom_response.last_modified else None
    release = Release(spec.name, version, default, released=released)
    scm = _text(pom, "scm", "url") or _text(pom, "url")
    release.sources = [scm] if scm else []
    release.licenses = [name for name in (_text(lic, "name") for lic in _children(pom, "licenses", "license")) if name]
    release.advisories = _github_advisories("maven", spec.name, version)
    return release


def _cargo(spec: Spec) -> Release:
    try:
        crate = fetch_json(f"{CRATES}/{_q(spec.name)}")["crate"]
    except NotFound:
        raise Missing.package("crate")
    default = crate.get("default_version") or crate.get("max_stable_version")
    version = _choose_version(spec, default)
    try:
        detail = fetch_json(f"{CRATES}/{_q(crate['name'])}/{_q(version)}")["version"]
    except NotFound:
        raise Missing.version(version)
    release = Release(crate["name"], version, default,
                      released=_parse_time(detail["created_at"]),
                      first_published=_parse_time(crate["created_at"]) if crate.get("created_at") else None)
    if detail.get("yanked"):
        release.warnings.append(f"yanked: {detail.get('yank_message') or 'no reason given'}")
    repository = detail.get("repository") or crate.get("repository")
    release.sources = [repository] if repository else []
    release.licenses = [detail["license"]] if detail.get("license") else []
    release.advisories = _github_advisories("rust", crate["name"], version)
    return release


def _nuget_normalize(version: str) -> str:
    """NuGet's normalized form: no build metadata or leading zeros, at least three parts, no zero fourth part."""
    core, dash, prerelease = version.split("+", 1)[0].lower().partition("-")
    parts = core.split(".")
    if 1 <= len(parts) <= 4 and all(part.isdigit() for part in parts):
        numbers = [str(int(part)) for part in parts] + ["0"] * (3 - len(parts))
        core = ".".join(numbers[:3] if numbers[3:] == ["0"] else numbers)
    return core + dash + prerelease


def _is_unlisted_date(published: str) -> bool:
    # NuGet marks unlisted packages with a 1900 publish date.
    return published.startswith("1900-")


def _nuget(spec: Spec) -> Release:
    try:
        index = fetch_json(f"{NUGET_REGISTRATION}/{_q(spec.name.lower())}/index.json")
    except NotFound:
        raise Missing.package("package")
    entries = []
    for page in index.get("items", []):
        leaves = page.get("items")
        if leaves is None:
            if not page["@id"].startswith(f"{NUGET_REGISTRATION}/"):
                raise LookupFailed(f"unexpected NuGet page URL: {page['@id']}")
            leaves = fetch_json(page["@id"])["items"]
        entries += [leaf["catalogEntry"] for leaf in leaves]
    if not entries:
        raise Missing.package("package")
    listed = [entry for entry in entries if entry.get("listed", True)]
    stable = [entry for entry in listed if "-" not in entry["version"]]
    default = (stable or listed or [{}])[-1].get("version")
    version = _choose_version(spec, default)
    wanted = _nuget_normalize(version)
    entry = next((e for e in entries if _nuget_normalize(e["version"]) == wanted), None)
    if entry is None:
        raise Missing.version(version)
    published = [_parse_time(e["published"]) for e in entries
                 if e.get("published") and not _is_unlisted_date(e["published"])]
    released = entry.get("published")
    release = Release(entry["id"], entry["version"], default,
                      released=_parse_time(released) if released and not _is_unlisted_date(released) else None,
                      first_published=min(published) if published else None)
    if not entry.get("listed", True):
        release.warnings.append("unlisted by its owner")
    deprecation = entry.get("deprecation")
    if deprecation:
        alternative = (deprecation.get("alternatePackage") or {}).get("id")
        reasons = ", ".join(deprecation.get("reasons", [])) or "no reason given"
        release.warnings.append(f"deprecated ({reasons})" + (f"; alternative: {alternative}" if alternative else ""))
    if entry.get("projectUrl"):
        release.sources = [entry["projectUrl"]]
    license_value = entry.get("licenseExpression") or entry.get("licenseUrl")
    release.licenses = [license_value] if license_value else []
    release.advisories = _github_advisories("nuget", entry["id"], entry["version"])
    return release


def _rubygems(spec: Spec) -> Release:
    try:
        gem = fetch_json(f"{RUBYGEMS}/gems/{_q(spec.name)}.json")
    except NotFound:
        raise Missing.package("gem")
    version = _choose_version(spec, gem.get("version"))
    versions = fetch_json(f"{RUBYGEMS}/versions/{_q(gem['name'])}.json")
    matches = sorted((v for v in versions if v["number"] == version), key=lambda v: v.get("platform") != "ruby")
    if not matches:
        raise Missing.version(version, "; RubyGems also hides yanked versions")
    created = [_parse_time(v["created_at"]) for v in versions if v.get("created_at")]
    release = Release(gem["name"], version, gem.get("version"),
                      released=_parse_time(matches[0]["created_at"]),
                      first_published=min(created) if created else None)
    source = gem.get("source_code_uri") or gem.get("homepage_uri")
    release.sources = [source] if source else []
    release.licenses = matches[0].get("licenses") or []
    release.advisories = _github_advisories("rubygems", gem["name"], version)
    return release


LOOKUPS = {"npm": _npm, "pypi": _pypi, "go": _go, "maven": _maven,
           "cargo": _cargo, "nuget": _nuget, "rubygems": _rubygems}


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


def check(spec: Spec, now: datetime) -> Report:
    report = Report(spec)
    try:
        release = LOOKUPS[spec.ecosystem](spec)
    except Missing as missing:
        report.status = "NOT_FOUND"
        report.lines.append(str(missing))
        return report
    except NoDefaultVersion:
        report.status = "UNCHECKED"
        report.lines.append("registry reports no default version; pass an explicit version")
        return report

    if release.first_published:
        report.lines.append(f"package first published {release.first_published.date()}")
    if release.name != spec.name:
        report.lines.append(f"registry name: {release.name}")
    if release.version == release.default:
        report.lines.append(f"version {release.version} (registry default)")
    else:
        report.lines.append(f"version {release.version}; registry default is {release.default or 'unknown'}")
    if release.released:
        age_days = (now - release.released).days
        report.lines.append(f"released {release.released.date()} ({age_days} days ago)")
        if age_days < RECENT_RELEASE_DAYS:
            report.flags.append(f"released under {RECENT_RELEASE_DAYS} days ago; scrutinize before adopting")
    else:
        report.lines.append("release date not reported by the registry")
    report.flags += release.warnings
    report.lines.append("source (unverified): " + (", ".join(release.sources) or "none listed"))
    report.lines.append("licenses: " + (", ".join(release.licenses) or "none listed"))
    if release.advisories:
        report.flags.append("advisories: " + ", ".join(sorted(set(release.advisories))))
    else:
        report.lines.append(f"no advisories in the {release.advisory_source} for {release.version} as of {now.date()}")
    return report


def run(specs: list[Spec], allow_public_scoped: bool, now: datetime) -> list[Report]:
    reports = []
    for spec in specs:
        if spec.ecosystem == "npm" and spec.name.startswith("@") and not allow_public_scoped:
            report = Report(spec, status="SKIPPED")
            report.lines.append("scoped npm name not sent to the npm registry; rerun with --public if it is public")
            reports.append(report)
            continue
        try:
            reports.append(check(spec, now))
        except (LookupFailed, NotFound, KeyError, ValueError, TypeError, AttributeError, IndexError) as error:
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
