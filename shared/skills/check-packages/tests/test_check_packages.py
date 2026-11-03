import argparse
import contextlib
import io
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import check_packages as cp  # noqa: E402

NOW = datetime(2026, 11, 3, tzinfo=timezone.utc)
PACKAGE_URL = "https://api.deps.dev/v3/systems/npm/packages/left-pad"


def package(default="1.3.0"):
    return {
        "packageKey": {"system": "NPM", "name": "left-pad"},
        "versions": [
            {"versionKey": {"version": "1.0.0"}, "publishedAt": "2014-03-01T00:00:00Z", "isDefault": False},
            {"versionKey": {"version": default}, "publishedAt": "2018-04-09T00:00:00Z", "isDefault": True},
        ],
    }


def version_detail(published="2018-04-09T00:00:00Z", **extra):
    return {"publishedAt": published, "isDeprecated": False, "licenses": ["MIT"],
            "links": [{"label": "SOURCE_REPO", "url": "https://github.com/left-pad/left-pad"}], **extra}


def fake_fetch(responses):
    """Serve canned responses by URL; OSV responses are keyed by page token."""
    calls = []

    def fetch(url, body=None):
        calls.append((url, body))
        key = url if body is None else (url, (body or {}).get("page_token"))
        value = responses[key]
        if isinstance(value, Exception):
            raise value
        return value

    return fetch, calls


def run_one(spec_text, responses, public=False):
    fetch, calls = fake_fetch(responses)
    with mock.patch.object(cp, "fetch_json", fetch):
        [report] = cp.run([cp.parse_spec(spec_text)], public, NOW)
    return report, calls


class ParseSpecTest(unittest.TestCase):
    def test_versions_and_scopes(self):
        self.assertEqual(cp.parse_spec("npm:left-pad"), cp.Spec("npm", "left-pad", None))
        self.assertEqual(cp.parse_spec("NPM:left-pad@1.3.0"), cp.Spec("npm", "left-pad", "1.3.0"))
        self.assertEqual(cp.parse_spec("npm:@scope/pkg"), cp.Spec("npm", "@scope/pkg", None))
        self.assertEqual(cp.parse_spec("npm:@scope/pkg@2.0.0"), cp.Spec("npm", "@scope/pkg", "2.0.0"))
        self.assertEqual(cp.parse_spec("maven:org.slf4j:slf4j-api@2.0.9"),
                         cp.Spec("maven", "org.slf4j:slf4j-api", "2.0.9"))

    def test_rejects_malformed(self):
        for text in ("left-pad", "foo:bar", "npm:", "npm:left-pad@"):
            with self.subTest(text=text), self.assertRaises(argparse.ArgumentTypeError):
                cp.parse_spec(text)


class CheckTest(unittest.TestCase):
    def osv(self, *pages):
        responses = {}
        for index, ids in enumerate(pages):
            token = None if index == 0 else f"t{index}"
            page = {"vulns": [{"id": vuln} for vuln in ids]}
            if index + 1 < len(pages):
                page["next_page_token"] = f"t{index + 1}"
            responses[(cp.OSV_QUERY, token)] = page
        return responses

    def test_clean_default_version_is_ok(self):
        report, calls = run_one("npm:left-pad", {
            PACKAGE_URL: package(), f"{PACKAGE_URL}/versions/1.3.0": version_detail(), **self.osv([])})
        self.assertTrue(report.ok)
        self.assertIn("version 1.3.0 (registry default)", report.lines)
        self.assertEqual(calls[-1][1]["package"], {"name": "left-pad", "ecosystem": "npm"})

    def test_pinned_older_version_names_default(self):
        report, _ = run_one("npm:left-pad@1.0.0", {
            PACKAGE_URL: package(), f"{PACKAGE_URL}/versions/1.0.0": version_detail(), **self.osv([])})
        self.assertIn("version 1.0.0; registry default is 1.3.0", report.lines)

    def test_advisories_follow_pagination(self):
        report, _ = run_one("npm:left-pad", {
            PACKAGE_URL: package(), f"{PACKAGE_URL}/versions/1.3.0": version_detail(),
            **self.osv(["GHSA-b"], ["GHSA-a"])})
        self.assertFalse(report.ok)
        self.assertIn("advisories: GHSA-a, GHSA-b", report.flags)
        self.assertIn("FLAGGED", report.render())

    def test_recent_release_and_deprecation_flag(self):
        report, _ = run_one("npm:left-pad", {
            PACKAGE_URL: package(),
            f"{PACKAGE_URL}/versions/1.3.0": version_detail(
                published="2026-10-30T00:00:00Z", isDeprecated=True, deprecatedReason="use String.padStart"),
            **self.osv([])})
        self.assertEqual(len(report.flags), 2)
        self.assertTrue(report.flags[0].startswith("released under 7 days ago"))
        self.assertEqual(report.flags[1], "deprecated: use String.padStart")

    def test_missing_package_and_version(self):
        report, _ = run_one("npm:left-pad", {PACKAGE_URL: cp.NotFound(PACKAGE_URL)})
        self.assertEqual(report.status, "NOT_FOUND")
        report, _ = run_one("npm:left-pad@9.9.9", {
            PACKAGE_URL: package(), f"{PACKAGE_URL}/versions/9.9.9": cp.NotFound("")})
        self.assertEqual(report.status, "NOT_FOUND")

    def test_failed_advisory_lookup_is_unchecked_not_clean(self):
        report, _ = run_one("npm:left-pad", {
            PACKAGE_URL: package(), f"{PACKAGE_URL}/versions/1.3.0": version_detail(),
            (cp.OSV_QUERY, None): cp.LookupFailed("HTTP 503")})
        self.assertEqual(report.status, "UNCHECKED")
        self.assertFalse(report.ok)
        self.assertNotIn("no OSV advisories", report.render())

    def test_missing_osv_endpoint_is_unchecked(self):
        report, _ = run_one("npm:left-pad", {
            PACKAGE_URL: package(), f"{PACKAGE_URL}/versions/1.3.0": version_detail(),
            (cp.OSV_QUERY, None): cp.NotFound(cp.OSV_QUERY)})
        self.assertEqual(report.status, "UNCHECKED")

    def test_unexpected_response_shape_is_unchecked(self):
        report, _ = run_one("npm:left-pad", {PACKAGE_URL: {"versions": []}})
        self.assertEqual(report.status, "UNCHECKED")


class ScopedNameTest(unittest.TestCase):
    def test_scoped_npm_name_is_not_sent_without_public(self):
        report, calls = run_one("npm:@client/internal", {})
        self.assertEqual(report.status, "SKIPPED")
        self.assertFalse(report.ok)
        self.assertEqual(calls, [])

    def test_public_flag_queries_scoped_name(self):
        report, calls = run_one("npm:@client/internal", {
            "https://api.deps.dev/v3/systems/npm/packages/%40client%2Finternal": cp.NotFound("")}, public=True)
        self.assertEqual(report.status, "NOT_FOUND")
        self.assertEqual(len(calls), 1)


class ExitStatusTest(unittest.TestCase):
    def test_nonzero_unless_every_package_ok(self):
        for status, expected in (("OK", 0), ("SKIPPED", 1)):
            report = cp.Report(cp.Spec("npm", "a", None), status=status)
            with mock.patch.object(cp, "run", return_value=[report]), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cp.main(["npm:a"]), expected)


if __name__ == "__main__":
    unittest.main()
