import argparse
import contextlib
import io
import json
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import check_packages as cp  # noqa: E402

NOW = datetime(2026, 11, 7, tzinfo=timezone.utc)
GITHUB = "https://api.github.com/advisories"

# Fixtures are trimmed from real registry responses captured on 2026-11-07.


def as_json(value, last_modified="", link=""):
    return cp.Response(json.dumps(value), last_modified, link)


def fake_fetch(responses):
    """Serve canned responses by URL, or by (URL, body) for POST requests."""
    calls = []

    def fetch(url, body=None):
        calls.append((url, body))
        value = responses[url if body is None else (url, json.dumps(body, sort_keys=True))]
        if isinstance(value, Exception):
            raise value
        return value

    return fetch, calls


def run_one(spec_text, responses, public=False):
    fetch, calls = fake_fetch(responses)
    with mock.patch.object(cp, "fetch", fetch):
        [report] = cp.run([cp.parse_spec(spec_text)], public, NOW)
    return report, calls


def github(ecosystem, name, version, advisories=(), url=None, link=""):
    url = url or f"{GITHUB}?ecosystem={ecosystem}&affects={cp._q(f'{name}@{version}')}&per_page=100"
    return {url: as_json(list(advisories), link=link)}


class ParseSpecTest(unittest.TestCase):
    def test_versions_and_scopes(self):
        self.assertEqual(cp.parse_spec("npm:left-pad"), cp.Spec("npm", "left-pad", None))
        self.assertEqual(cp.parse_spec("NPM:left-pad@1.3.0"), cp.Spec("npm", "left-pad", "1.3.0"))
        self.assertEqual(cp.parse_spec("npm:@scope/pkg"), cp.Spec("npm", "@scope/pkg", None))
        self.assertEqual(cp.parse_spec("npm:@scope/pkg@2.0.0"), cp.Spec("npm", "@scope/pkg", "2.0.0"))
        self.assertEqual(cp.parse_spec("maven:org.slf4j:slf4j-api@2.0.9"),
                         cp.Spec("maven", "org.slf4j:slf4j-api", "2.0.9"))

    def test_rejects_malformed(self):
        for text in ("left-pad", "foo:bar", "npm:", "npm:left-pad@", "maven:slf4j-api", "maven:org..slf4j:api",
                     "maven:org/slf4j:api", "maven:org.slf4j:api:extra"):
            with self.subTest(text=text), self.assertRaises(argparse.ArgumentTypeError):
                cp.parse_spec(text)


class FetchTest(unittest.TestCase):
    def curl(self, stdout, returncode=0, stderr=""):
        result = subprocess.CompletedProcess([], returncode, stdout=stdout, stderr=stderr)
        return mock.patch.object(cp.subprocess, "run", return_value=result)

    def test_reads_body_status_and_headers(self):
        trailer = f"{cp.WRITE_OUT_MARKER}200\tSun, 03 Sep 2023 16:14:33 GMT\t<https://api.github.com/x>; rel=\"next\""
        with self.curl('{"a": 1}' + trailer):
            response = cp.fetch("https://example.test/")
        self.assertEqual(response, cp.Response('{"a": 1}', "Sun, 03 Sep 2023 16:14:33 GMT",
                                               '<https://api.github.com/x>; rel="next"'))

    def test_not_found_statuses(self):
        for status in ("404", "410"):
            with self.subTest(status=status), self.curl(f"gone{cp.WRITE_OUT_MARKER}{status}\t\t"), \
                    self.assertRaises(cp.NotFound):
                cp.fetch("https://example.test/")

    def test_github_rate_limit_is_explained(self):
        with self.curl(f"{{}}{cp.WRITE_OUT_MARKER}403\t\t"), self.assertRaisesRegex(cp.LookupFailed, "60 unauth"):
            cp.fetch(f"{GITHUB}?ecosystem=go")

    def test_curl_failure_and_other_status_fail(self):
        with self.curl("", returncode=56, stderr="CONNECT tunnel failed"), \
                self.assertRaisesRegex(cp.LookupFailed, "CONNECT tunnel failed"):
            cp.fetch("https://example.test/")
        with self.curl(f"oops{cp.WRITE_OUT_MARKER}500\t\t"), self.assertRaisesRegex(cp.LookupFailed, "HTTP 500"):
            cp.fetch("https://example.test/")


NPM_LEFT_PAD = {
    "name": "left-pad",
    "dist-tags": {"latest": "1.3.0"},
    "time": {"created": "2014-03-14T00:00:00Z", "1.0.0": "2014-03-14T00:00:00Z", "1.3.0": "2018-04-09T00:00:00Z"},
    "versions": {
        "1.0.0": {"license": "WTFPL"},
        "1.3.0": {"license": "WTFPL", "repository": {"type": "git", "url": "git+ssh://git@github.com/stevemao/left-pad.git"}},
    },
}
NPM_BULK = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk"


def npm_bulk(name, version, advisories=()):
    return {(NPM_BULK, json.dumps({name: [version]}, sort_keys=True)): as_json({name: list(advisories)} if advisories else {})}


class NpmTest(unittest.TestCase):
    def test_clean_default_version_is_ok(self):
        responses = {"https://registry.npmjs.org/left-pad": as_json(NPM_LEFT_PAD), **npm_bulk("left-pad", "1.3.0")}
        report, _ = run_one("npm:left-pad", responses)
        self.assertEqual(report.status, "OK")
        self.assertTrue(report.ok)
        self.assertIn("version 1.3.0 (registry default)", report.lines)
        self.assertIn("package first published 2014-03-14", report.lines)
        self.assertIn("source (unverified): git+ssh://git@github.com/stevemao/left-pad.git", report.lines)
        self.assertIn("licenses: WTFPL", report.lines)

    def test_deprecation_and_advisories_flag(self):
        package = json.loads(json.dumps(NPM_LEFT_PAD))
        package["versions"]["1.0.0"]["deprecated"] = "use String.prototype.padStart()"
        advisory = {"id": 1, "url": "https://github.com/advisories/GHSA-35jh-r3h4-6jhm"}
        responses = {"https://registry.npmjs.org/left-pad": as_json(package),
                     **npm_bulk("left-pad", "1.0.0", [advisory])}
        report, _ = run_one("npm:left-pad@1.0.0", responses)
        self.assertEqual(report.render().splitlines()[0], "FLAGGED  npm:left-pad@1.0.0")
        self.assertIn("version 1.0.0; registry default is 1.3.0", report.lines)
        self.assertIn("deprecated: use String.prototype.padStart()", report.flags)
        self.assertIn("advisories: GHSA-35jh-r3h4-6jhm", report.flags)

    def test_missing_package_and_version(self):
        report, _ = run_one("npm:left-pad", {"https://registry.npmjs.org/left-pad": cp.NotFound("x")})
        self.assertEqual(report.status, "NOT_FOUND")
        self.assertIn("typos or lookalikes", report.lines[0])
        report, _ = run_one("npm:left-pad@9.9.9", {"https://registry.npmjs.org/left-pad": as_json(NPM_LEFT_PAD)})
        self.assertEqual((report.status, report.lines), ("NOT_FOUND", ["version 9.9.9 does not exist"]))

    def test_scoped_name_is_not_sent_without_public(self):
        report, calls = run_one("npm:@scope/pkg", {})
        self.assertEqual(report.status, "SKIPPED")
        self.assertEqual(calls, [])

    def test_public_flag_queries_scoped_name_with_encoded_slash(self):
        package = {**NPM_LEFT_PAD, "name": "@scope/pkg"}
        responses = {"https://registry.npmjs.org/@scope%2Fpkg": as_json(package), **npm_bulk("@scope/pkg", "1.3.0")}
        report, calls = run_one("npm:@scope/pkg", responses, public=True)
        self.assertEqual(report.status, "OK")
        self.assertEqual(calls[0][0], "https://registry.npmjs.org/@scope%2Fpkg")


PYPI_REQUESTS = {
    "info": {"name": "requests", "version": "2.34.2"},
    "releases": {"2.19.0": [{"upload_time_iso_8601": "2018-06-12T14:46:15.289074Z"}],
                 "0.2.0": [{"upload_time_iso_8601": "2011-02-14T18:20:46.000000Z"}]},
}


def pypi_version(**info):
    return {
        "info": {"license": "Apache 2.0\nfull licence text follows", "license_expression": None,
                 "project_urls": {"Homepage": "https://requests.readthedocs.io", "Source": "https://github.com/psf/requests"},
                 "yanked": False, "yanked_reason": None, **info},
        "urls": [{"upload_time_iso_8601": "2018-06-12T14:46:15.289074Z"}],
        "vulnerabilities": [
            {"id": "PYSEC-2018-28", "aliases": ["GHSA-x84v-xcm2-53pg"], "withdrawn": None},
            {"id": "PYSEC-2099-1", "withdrawn": "2024-01-01T00:00:00Z"},
        ],
    }


class PypiTest(unittest.TestCase):
    def test_advisories_skip_withdrawn_and_metadata_is_read(self):
        responses = {"https://pypi.org/pypi/requests/json": as_json(PYPI_REQUESTS),
                     "https://pypi.org/pypi/requests/2.19.0/json": as_json(pypi_version())}
        report, _ = run_one("pypi:requests@2.19.0", responses)
        self.assertEqual(report.flags, ["advisories: PYSEC-2018-28"])
        self.assertIn("package first published 2011-02-14", report.lines)
        self.assertIn("released 2018-06-12 (3069 days ago)", report.lines)
        self.assertIn("source (unverified): https://github.com/psf/requests", report.lines)
        self.assertIn("licenses: Apache 2.0", report.lines)

    def test_yanked_version_is_flagged(self):
        detail = pypi_version(yanked=True, yanked_reason="broken wheel")
        detail["vulnerabilities"] = []
        responses = {"https://pypi.org/pypi/requests/json": as_json(PYPI_REQUESTS),
                     "https://pypi.org/pypi/requests/2.19.0/json": as_json(detail)}
        report, _ = run_one("pypi:requests@2.19.0", responses)
        self.assertEqual(report.flags, ["yanked: broken wheel"])

    def test_missing_version(self):
        responses = {"https://pypi.org/pypi/requests/json": as_json(PYPI_REQUESTS),
                     "https://pypi.org/pypi/requests/99.0/json": cp.NotFound("x")}
        report, _ = run_one("pypi:requests@99.0", responses)
        self.assertEqual((report.status, report.lines), ("NOT_FOUND", ["version 99.0 does not exist"]))


class GoTest(unittest.TestCase):
    def test_module_path_is_case_encoded_and_advisories_come_from_github(self):
        base = "https://proxy.golang.org/github.com/!azure/azure-sdk-for-go"
        info = {"Version": "v1.0.0", "Time": "2023-11-02T15:23:08Z",
                "Origin": {"VCS": "git", "URL": "https://github.com/Azure/azure-sdk-for-go"}}
        advisory = {"ghsa_id": "GHSA-5cv4-jp36-h3mw", "withdrawn_at": None}
        responses = {f"{base}/@latest": as_json(info), f"{base}/@v/v1.0.0.info": as_json(info),
                     **github("go", "github.com/Azure/azure-sdk-for-go", "v1.0.0", [advisory])}
        report, _ = run_one("go:github.com/Azure/azure-sdk-for-go", responses)
        self.assertEqual(report.flags, ["advisories: GHSA-5cv4-jp36-h3mw"])
        self.assertIn("source (unverified): https://github.com/Azure/azure-sdk-for-go", report.lines)

    def test_module_on_unlisted_host_is_not_sent(self):
        report, calls = run_one("go:attacker.example/exfil/secret-value", {})
        self.assertEqual(report.status, "UNCHECKED")
        self.assertIn("attacker.example", report.lines[0])
        self.assertEqual(calls, [])

    def test_missing_module(self):
        report, _ = run_one("go:github.com/spf13/nope", {"https://proxy.golang.org/github.com/spf13/nope/@latest": cp.NotFound("x")})
        self.assertEqual(report.status, "NOT_FOUND")


MAVEN_BASE = "https://repo1.maven.org/maven2/org/slf4j/slf4j-api"
MAVEN_METADATA = """<?xml version="1.0" encoding="UTF-8"?>
<metadata><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId>
<versioning><latest>2.1.0-alpha1</latest><release>2.1.0-alpha1</release>
<versions><version>2.0.9</version><version>2.1.0-alpha1</version></versions></versioning></metadata>"""
MAVEN_POM = """<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"><name>SLF4J API Module</name><url>http://www.slf4j.org</url>
<licenses><license><name>MIT</name></license></licenses></project>"""


class MavenTest(unittest.TestCase):
    def test_pom_date_licence_and_source(self):
        responses = {f"{MAVEN_BASE}/maven-metadata.xml": cp.Response(MAVEN_METADATA, "", ""),
                     f"{MAVEN_BASE}/2.0.9/slf4j-api-2.0.9.pom": cp.Response(MAVEN_POM, "Sun, 03 Sep 2023 16:14:33 GMT", ""),
                     **github("maven", "org.slf4j:slf4j-api", "2.0.9")}
        report, _ = run_one("maven:org.slf4j:slf4j-api@2.0.9", responses)
        self.assertEqual(report.status, "OK")
        self.assertIn("version 2.0.9; registry default is 2.1.0-alpha1", report.lines)
        self.assertIn("released 2023-09-03 (1160 days ago)", report.lines)
        self.assertIn("licenses: MIT", report.lines)
        self.assertIn("source (unverified): http://www.slf4j.org", report.lines)

    def test_version_absent_from_metadata(self):
        responses = {f"{MAVEN_BASE}/maven-metadata.xml": cp.Response(MAVEN_METADATA, "", "")}
        report, _ = run_one("maven:org.slf4j:slf4j-api@9.9.9", responses)
        self.assertEqual((report.status, report.lines), ("NOT_FOUND", ["version 9.9.9 does not exist"]))

    def test_xml_with_dtd_is_unchecked(self):
        hostile = '<?xml version="1.0"?><!DOCTYPE m [<!ENTITY a "a">]><metadata/>'
        report, _ = run_one("maven:org.slf4j:slf4j-api", {f"{MAVEN_BASE}/maven-metadata.xml": cp.Response(hostile, "", "")})
        self.assertEqual(report.status, "UNCHECKED")
        self.assertIn("DTD", report.lines[0])


class CargoTest(unittest.TestCase):
    def test_yanked_version_is_flagged(self):
        crate = {"crate": {"name": "itoa", "default_version": "1.0.18", "created_at": "2016-06-25T21:50:33.832Z",
                           "repository": "https://github.com/dtolnay/itoa"}}
        version = {"version": {"num": "0.1.0", "created_at": "2016-06-25T21:50:33.832Z", "yanked": True,
                               "yank_message": None, "license": "MIT/Apache-2.0"}}
        responses = {"https://crates.io/api/v1/crates/itoa": as_json(crate),
                     "https://crates.io/api/v1/crates/itoa/0.1.0": as_json(version),
                     **github("rust", "itoa", "0.1.0")}
        report, _ = run_one("cargo:itoa@0.1.0", responses)
        self.assertEqual(report.flags, ["yanked: no reason given"])
        self.assertIn("licenses: MIT/Apache-2.0", report.lines)


def nuget_leaf(version, published="2021-04-15T17:47:22.707+00:00", listed=True, **extra):
    return {"catalogEntry": {"id": "Microsoft.Azure.Storage.Blob", "version": version, "published": published,
                             "listed": listed, "licenseExpression": "MIT", "projectUrl": "https://example.test/blob",
                             **extra}}


NUGET_INDEX = "https://api.nuget.org/v3/registration5-gz-semver2/microsoft.azure.storage.blob/index.json"


class NugetTest(unittest.TestCase):
    def test_external_page_deprecation_and_prerelease_default(self):
        page = "https://api.nuget.org/v3/registration5-gz-semver2/microsoft.azure.storage.blob/page/11.0.0/12.0.0-preview.json"
        deprecation = {"reasons": ["Legacy"], "alternatePackage": {"id": "Azure.Storage.Blobs", "range": "*"}}
        index = {"items": [
            {"@id": f"{NUGET_INDEX}#page/8.0.0/9.0.0", "items": [nuget_leaf("8.0.0", published="2018-01-22T00:00:00+00:00")]},
            {"@id": page},
        ]}
        responses = {NUGET_INDEX: as_json(index),
                     page: as_json({"items": [nuget_leaf("11.2.3", deprecation=deprecation),
                                              nuget_leaf("12.0.0-preview")]}),
                     **github("nuget", "Microsoft.Azure.Storage.Blob", "11.2.3")}
        report, _ = run_one("nuget:microsoft.azure.storage.blob", responses)
        self.assertIn("version 11.2.3 (registry default)", report.lines)
        self.assertIn("registry name: Microsoft.Azure.Storage.Blob", report.lines)
        self.assertIn("package first published 2018-01-22", report.lines)
        self.assertEqual(report.flags, ["deprecated (Legacy); alternative: Azure.Storage.Blobs"])

    def test_unlisted_version_is_flagged_without_release_date(self):
        index = {"items": [{"@id": NUGET_INDEX, "items": [
            nuget_leaf("1.0.0", published="1900-01-01T00:00:00+00:00", listed=False), nuget_leaf("2.0.0")]}]}
        responses = {NUGET_INDEX: as_json(index), **github("nuget", "Microsoft.Azure.Storage.Blob", "1.0.0")}
        report, _ = run_one("nuget:Microsoft.Azure.Storage.Blob@1.0.0", responses)
        self.assertEqual(report.flags, ["unlisted by its owner"])
        self.assertIn("release date not reported by the registry", report.lines)

    def test_equivalent_version_forms_match(self):
        index = {"items": [{"@id": NUGET_INDEX, "items": [nuget_leaf("11.2.3")]}]}
        responses = {NUGET_INDEX: as_json(index), **github("nuget", "Microsoft.Azure.Storage.Blob", "11.2.3")}
        for requested in ("11.2.3.0", "11.02.3", "11.2.3+build.5"):
            with self.subTest(requested=requested):
                report, _ = run_one(f"nuget:Microsoft.Azure.Storage.Blob@{requested}", responses)
                self.assertEqual(report.status, "OK")
        self.assertEqual(cp._nuget_normalize("1.0"), "1.0.0")
        self.assertEqual(cp._nuget_normalize("1.0.0.1-Beta"), "1.0.0.1-beta")

    def test_page_outside_registration_base_is_not_fetched(self):
        index = {"items": [{"@id": "https://evil.test/page.json"}]}
        report, calls = run_one("nuget:Microsoft.Azure.Storage.Blob", {NUGET_INDEX: as_json(index)})
        self.assertEqual(report.status, "UNCHECKED")
        self.assertEqual(len(calls), 1)


class RubygemsTest(unittest.TestCase):
    GEM = {"name": "rack", "version": "3.2.8", "source_code_uri": "https://github.com/rack/rack"}
    VERSIONS = [
        {"number": "3.2.8", "created_at": "2026-10-30T02:15:59.501Z", "licenses": ["MIT"], "platform": "java"},
        {"number": "3.2.8", "created_at": "2026-10-29T02:15:59.501Z", "licenses": ["MIT"], "platform": "ruby"},
        {"number": "1.0.0", "created_at": "2009-07-25T18:02:12.000Z", "licenses": None, "platform": "ruby"},
    ]

    def responses(self, version):
        return {"https://rubygems.org/api/v1/gems/rack.json": as_json(self.GEM),
                "https://rubygems.org/api/v1/versions/rack.json": as_json(self.VERSIONS),
                **github("rubygems", "rack", version)}

    def test_ruby_platform_preferred(self):
        report, _ = run_one("rubygems:rack", self.responses("3.2.8"))
        self.assertIn("released 2026-10-29 (8 days ago)", report.lines)
        self.assertIn("package first published 2009-07-25", report.lines)
        self.assertEqual(report.status, "OK")

    def test_missing_version_mentions_yanked(self):
        report, _ = run_one("rubygems:rack@99.0", self.responses("99.0"))
        self.assertEqual(report.lines, ["version 99.0 does not exist; RubyGems also hides yanked versions"])


class GithubAdvisoriesTest(unittest.TestCase):
    def test_pagination_and_withdrawn_filter(self):
        first = f"{GITHUB}?ecosystem=rust&affects=time%400.1.43&per_page=100"
        second = f"{GITHUB}?ecosystem=rust&affects=time%400.1.43&per_page=100&after=abc"
        responses = {
            first: as_json([{"ghsa_id": "GHSA-1", "withdrawn_at": None}], link=f'<{second}>; rel="next"'),
            second: as_json([{"ghsa_id": "GHSA-2", "withdrawn_at": "2024-01-03T20:06:13Z"},
                             {"ghsa_id": "GHSA-3", "withdrawn_at": None}]),
        }
        fetch, _ = fake_fetch(responses)
        with mock.patch.object(cp, "fetch", fetch):
            self.assertEqual(cp._github_advisories("rust", "time", "0.1.43"), ["GHSA-1", "GHSA-3"])

    def test_foreign_pagination_link_is_refused(self):
        with self.assertRaises(cp.LookupFailed):
            cp._next_link('<https://evil.test/advisories>; rel="next"')


class ReportTest(unittest.TestCase):
    def test_failed_advisory_lookup_is_unchecked_not_clean(self):
        responses = {"https://registry.npmjs.org/left-pad": as_json(NPM_LEFT_PAD),
                     (NPM_BULK, json.dumps({"left-pad": ["1.3.0"]}, sort_keys=True)): cp.LookupFailed("HTTP 503")}
        report, _ = run_one("npm:left-pad", responses)
        self.assertEqual(report.status, "UNCHECKED")
        self.assertIn("nothing about this package is verified", report.lines[0])

    def test_release_under_seven_days_is_flagged(self):
        package = json.loads(json.dumps(NPM_LEFT_PAD))
        package["time"]["1.3.0"] = "2026-11-04T00:00:00Z"
        responses = {"https://registry.npmjs.org/left-pad": as_json(package), **npm_bulk("left-pad", "1.3.0")}
        report, _ = run_one("npm:left-pad", responses)
        self.assertEqual(report.flags, ["released under 7 days ago; scrutinize before adopting"])

    def test_malformed_advisory_data_is_unchecked_not_clean(self):
        detail = pypi_version()
        del detail["vulnerabilities"]
        responses = {"https://pypi.org/pypi/requests/json": as_json(PYPI_REQUESTS),
                     "https://pypi.org/pypi/requests/2.19.0/json": as_json(detail)}
        report, _ = run_one("pypi:requests@2.19.0", responses)
        self.assertEqual(report.status, "UNCHECKED")
        crate = {"crate": {"name": "itoa", "default_version": "1.0.18"}}
        version = {"version": {"num": "1.0.18", "created_at": "2026-03-20T00:12:37Z", "yanked": False}}
        url = f"{GITHUB}?ecosystem=rust&affects=itoa%401.0.18&per_page=100"
        responses = {"https://crates.io/api/v1/crates/itoa": as_json(crate),
                     "https://crates.io/api/v1/crates/itoa/1.0.18": as_json(version), url: as_json({})}
        report, _ = run_one("cargo:itoa", responses)
        self.assertEqual(report.status, "UNCHECKED")

    def test_unexpected_response_shape_is_unchecked(self):
        report, _ = run_one("cargo:itoa", {"https://crates.io/api/v1/crates/itoa": as_json({"unexpected": True})})
        self.assertEqual(report.status, "UNCHECKED")

    def test_no_default_version_is_unchecked(self):
        report, _ = run_one("npm:left-pad", {"https://registry.npmjs.org/left-pad": as_json({"name": "left-pad"})})
        self.assertEqual(report.status, "UNCHECKED")
        self.assertIn("pass an explicit version", report.lines[0])

    def test_nonzero_unless_every_package_ok(self):
        responses = {"https://registry.npmjs.org/left-pad": as_json(NPM_LEFT_PAD), **npm_bulk("left-pad", "1.3.0")}
        fetch, _ = fake_fetch(responses)
        with mock.patch.object(cp, "fetch", fetch), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cp.main(["npm:left-pad"]), 0)
            self.assertEqual(cp.main(["npm:left-pad", "npm:@scope/private"]), 1)


if __name__ == "__main__":
    unittest.main()
