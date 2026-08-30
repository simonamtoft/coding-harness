#!/usr/bin/env python3
import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

import cost
import prompts
import search
import sessions
import show_session


class SessionScriptTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "session.jsonl"
        records = [
            {"type": "session", "id": "session-id", "cwd": "/project", "timestamp": "2026-08-30T12:00:00Z"},
            {"type": "model_change", "modelId": "model-a", "provider": "test"},
            {"type": "message", "message": {"role": "user", "timestamp": 1, "content": "Find the prior session"}},
            {"type": "message", "message": {"role": "assistant", "timestamp": 2, "model": "model-a", "usage": {"cost": {"total": 1}}}},
            {"type": "compaction", "usage": {"cost": {"total": 2}}},
            {"type": "branch_summary", "usage": {"cost": {"total": 3}}},
        ]
        self.path.write_text("".join(json.dumps(record) + "\n" for record in records))

    def tearDown(self):
        self.directory.cleanup()

    def test_string_user_content_is_available_to_all_prompt_consumers(self):
        summary = sessions.summarize_session(self.path)
        self.assertEqual(summary.user_prompt_concat, "Find the prior session")
        self.assertEqual(prompts._collect_prompts(self.path, 0, 0), [(1, "Find the prior session")])
        hits = search._search_session(
            summary,
            "user",
            lambda text: "prior" in text,
            lambda text: re.finditer("prior", text),
            10,
            0,
            80,
        )
        self.assertEqual(hits[0]["snippet"], "Find the prior session")

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            show_session._render_user({"content": "Find the prior session"}, "12:00:00")
        self.assertIn("Find the prior session", output.getvalue())

    def test_summary_records_are_included_in_cost_and_model_rollups(self):
        summary = sessions.summarize_session(self.path)
        self.assertEqual(summary.cost_total, 6)
        self.assertEqual(list(sessions.iter_usage_by_model(self.path)), [("model-a", 1.0), ("model-a", 2.0), ("model-a", 3.0)])
        self.assertEqual(dict(cost.session_keys(summary, "model")), {"model-a": 6.0})


if __name__ == "__main__":
    unittest.main()
