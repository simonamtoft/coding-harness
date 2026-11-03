import contextlib
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest

from configure import merge


class ProviderMergeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "models.json"
        self.provider = {"baseUrl": "http://127.0.0.1:18080/v1", "models": [{"id": "bonsai-2-pq2"}]}

    def merge(self):
        with contextlib.redirect_stdout(io.StringIO()):
            merge(self.path, self.provider)

    def test_preserves_existing_values_and_exact_backup(self):
        original = b'{"providers":{"existing":{"apiKey":"test-placeholder"}},"other":true}\n'
        self.path.write_bytes(original)
        self.merge()
        result = json.loads(self.path.read_text())
        self.assertEqual(result["providers"].pop("bonsai-local"), self.provider)
        self.assertEqual(result, json.loads(original))
        backup, = self.path.parent.glob("*.bak")
        self.assertEqual(backup.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)

    def test_identical_provider_is_noop(self):
        self.merge()
        original = self.path.read_bytes()
        self.merge()
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(self.path.parent.glob("*.bak")), [])

    def test_adds_profile_to_matching_provider_with_backup(self):
        self.provider["models"].append({"id": "bonsai-2-ptq1"})
        original_provider = {**self.provider, "models": self.provider["models"][:1]}
        original = json.dumps({"providers": {"bonsai-local": original_provider}}).encode()
        self.path.write_bytes(original)
        self.merge()
        result = json.loads(self.path.read_text())
        self.assertEqual(result["providers"]["bonsai-local"], self.provider)
        backup, = self.path.parent.glob("*.bak")
        self.assertEqual(backup.read_bytes(), original)

    def test_conflicting_provider_is_not_replaced(self):
        original = b'{"providers":{"bonsai-local":{"baseUrl":"different"}}}'
        self.path.write_bytes(original)
        with self.assertRaises(ValueError):
            self.merge()
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(self.path.parent.glob("*.bak")), [])

    def test_changed_existing_model_is_not_replaced(self):
        original = b'{"providers":{"bonsai-local":{"baseUrl":"http://127.0.0.1:18080/v1","models":[{"id":"bonsai-2-pq2","changed":true}]}}}'
        self.path.write_bytes(original)
        with self.assertRaises(ValueError):
            self.merge()
        self.assertEqual(self.path.read_bytes(), original)

    def test_symlink_is_not_replaced(self):
        target = self.path.with_name("target.json")
        target.write_text('{}')
        self.path.symlink_to(target)
        with self.assertRaises(ValueError):
            self.merge()
        self.assertTrue(self.path.is_symlink())
        self.assertEqual(target.read_text(), '{}')

    def test_invalid_json_is_not_replaced(self):
        self.path.write_text('{invalid')
        with self.assertRaises(json.JSONDecodeError):
            self.merge()
        self.assertEqual(self.path.read_text(), '{invalid')


if __name__ == "__main__":
    unittest.main()
