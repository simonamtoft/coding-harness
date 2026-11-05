#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import sessions
import skill_usage as U


def read_call(path):
    return {"type": "toolCall", "name": "read", "arguments": {"path": path}}


def message(role, content):
    return {"type": "message", "message": {"role": role, "content": content}}


class SkillUsageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def summary(self, session_id, records):
        path = self.root / f"{session_id}.jsonl"
        header = {"type": "session", "id": session_id, "cwd": "/project", "timestamp": "2026-10-01T12:00:00Z"}
        path.write_text("".join(json.dumps(r) + "\n" for r in [header, *records]))
        return sessions.summarize_session(path)

    def test_explicit_invocations_and_model_loads_count_per_session(self):
        usage = {}
        U.add_session(usage, self.summary("a", [
            message("user", '<skill name="quick-commit" location="/h/.pi/agent/skills/quick-commit/SKILL.md">\nbody'),
            message("assistant", [
                read_call("~/.pi/agent/skills/bulk-read/SKILL.md"),
                read_call("/repo/.agents/skills/bulk-read/SKILL.md"),
                read_call("/h/.pi/agent/skills/bulk-read/BULK-READER.md"),
            ]),
        ]))
        U.add_session(usage, self.summary("b", [message("assistant", [read_call("/repo/.pi/skills/bulk-read/SKILL.md")])]))

        self.assertEqual(usage["quick-commit"].explicit, 1)
        self.assertEqual(usage["quick-commit"].session_ids, {"a"})
        self.assertEqual(usage["bulk-read"].model_loads, 3)
        self.assertEqual(usage["bulk-read"].resource_reads, 1)
        self.assertEqual(usage["bulk-read"].session_ids, {"a", "b"})

    def test_source_checkout_reads_and_quoted_skill_tags_are_not_usage(self):
        usage = {}
        U.add_session(usage, self.summary("a", [
            message("user", 'Why did <skill name="present"> not load?'),
            message("assistant", [read_call("shared/skills/present/SKILL.md")]),
        ]))
        self.assertEqual(usage, {})

    def test_render_lists_unused_installed_and_uninstalled_skills(self):
        usage = {}
        U.add_session(usage, self.summary("a", [message("assistant", [read_call("/h/.pi/agent/skills/old/SKILL.md")])]))
        text = U.render(usage, {"present", "unused"}, 1)
        self.assertIn("Installed, not loaded in scope (2): present, unused", text)
        self.assertIn("Seen but not installed now (1): old", text)


if __name__ == "__main__":
    unittest.main()
