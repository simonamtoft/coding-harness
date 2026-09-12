#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
HOOK = ROOT / "claude/hooks/route-bulk-read.py"
SPEC = importlib.util.spec_from_file_location("route_bulk_read", HOOK)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CASES = json.loads((ROOT / "shared/read-routing-cases.json").read_text())


class ReadRoutingTest(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(dir=os.environ.get("PI_SESSION_TMPDIR"))
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.large = self.root / "source.txt"
        self.large.write_text(("x" * 40 + "\n") * 1000)

    def payload(self, **fields):
        return {"hook_event_name": "PreToolUse", "tool_name": "Read", "cwd": str(self.root),
                "tool_input": {"file_path": str(self.large)}, **fields}

    def run_hook(self, payload, hook=HOOK, **env):
        return subprocess.run(
            ["bash" if hook.suffix == ".sh" else "python3", str(hook)],
            input=json.dumps(payload), capture_output=True, text=True,
            env={**os.environ, "CLAUDE_HOOK_DISABLE": "", **env}, timeout=10,
        )

    def test_shared_contract(self):
        for index, fixture in enumerate(CASES):
            with self.subTest(fixture["name"]):
                cwd = self.root / str(index)
                path = cwd / fixture["path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                newline = fixture.get("newline", "\n")
                content = newline.join(["x" * fixture.get("lineWidth", 1)] * fixture["lines"])
                if fixture["lines"] > 0 and fixture.get("trailingNewline", True):
                    content += newline
                path.write_bytes(content.encode())
                for operand in (fixture["path"], str(path)):
                    payload = self.payload(cwd=str(cwd), tool_input={
                        **{key: fixture[key] for key in ("offset", "limit") if key in fixture},
                        "file_path": operand,
                    })
                    self.assertEqual(MODULE.should_route(payload), fixture["route"])

    def test_child_exemption_does_not_exempt_top_level_custom_agent(self):
        self.assertFalse(MODULE.should_route(self.payload(agent_id="child-1", agent_type="bulk-reader")))
        self.assertTrue(MODULE.should_route(self.payload(agent_type="bulk-reader")))
        self.assertTrue(MODULE.should_route(self.payload(agent_id="")))

    def test_native_failures_are_not_routing_errors(self):
        for payload in ([], None, {}, self.payload(tool_name="Bash"), self.payload(tool_input=None),
                        self.payload(tool_input={"file_path": "bad\0path"}),
                        self.payload(tool_input={"file_path": str(self.root / "missing")}),
                        self.payload(tool_input={"file_path": str(self.root)})):
            with self.subTest(payload=payload):
                self.assertFalse(MODULE.should_route(payload))

    def test_symlinks(self):
        alias = self.root / "alias.txt"
        alias.symlink_to(self.large)
        self.assertTrue(MODULE.should_route(self.payload(tool_input={"file_path": str(alias)})))
        instructions = self.root / "AGENTS.md"
        instructions.symlink_to(self.large)
        self.assertFalse(MODULE.should_route(self.payload(tool_input={"file_path": str(instructions)})))
        canonical_instruction = self.root / "CONTEXT.md"
        canonical_instruction.write_text(("x" * 40 + "\n") * 1000)
        instruction_alias = self.root / "instruction-alias.txt"
        instruction_alias.symlink_to(canonical_instruction)
        self.assertFalse(MODULE.should_route(self.payload(tool_input={"file_path": str(instruction_alias)})))

    def test_cli_blocks_with_redirect_and_never_grants_permissions(self):
        result = self.run_hook(self.payload())
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("bulk-read/SKILL.md", result.stderr)
        self.assertIn("exceeds 16 KiB", result.stderr)
        self.assertIn("1\u2013350 lines", result.stderr)
        self.assertNotIn("x" * 100, result.stderr)
        for payload in (self.payload(agent_id="child"), self.payload(tool_input={
                "file_path": str(self.large), "limit": 350})):
            result = self.run_hook(payload)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        self.assertEqual(self.run_hook(self.payload(), CLAUDE_HOOK_DISABLE="1").returncode, 0)

    def test_oversized_file_routes_without_reading_its_contents(self):
        with self.large.open("wb") as source:
            source.truncate(1024 * 1024 * 1024)
        with patch.object(MODULE.os, "read") as read:
            self.assertTrue(MODULE.should_route(self.payload()))
            read.assert_not_called()

    def test_multibyte_characters_are_measured_as_bytes(self):
        self.large.write_text("é" * 8192)
        self.assertFalse(MODULE.should_route(self.payload()))
        self.large.write_text("é" * 8192 + "x")
        self.assertTrue(MODULE.should_route(self.payload()))

    def test_repeated_bounded_reads_remain_direct(self):
        for offset in (1, 351, 701):
            self.assertFalse(MODULE.should_route(self.payload(tool_input={
                "file_path": str(self.large), "offset": offset, "limit": 350})))
        self.assertTrue(MODULE.should_route(self.payload(tool_input={
            "file_path": str(self.large), "offset": 701})))

    def test_cost_exemptions_do_not_disable_secret_guard(self):
        secret = self.root / "private.key"
        secret.write_text("synthetic fixture only")
        guard = ROOT / "claude/hooks/check-read.sh"
        for payload in (self.payload(agent_id="child", tool_input={"file_path": str(secret)}),
                        self.payload(tool_input={"file_path": str(secret), "limit": 350})):
            self.assertEqual(self.run_hook(payload).returncode, 0)
            result = self.run_hook(payload, hook=guard)
            self.assertEqual(result.returncode, 2, result.stderr)

    def test_settings_keep_both_independent_read_hooks(self):
        settings = json.loads((ROOT / "claude/settings.json").read_text())
        commands = [hook["command"] for group in settings["hooks"]["PreToolUse"]
                    if group["matcher"] == "Read" for hook in group["hooks"]]
        self.assertIn("bash $HOME/.claude/hooks/check-read.sh", commands)
        self.assertIn("python3 $HOME/.claude/hooks/route-bulk-read.py", commands)

    def test_claude_worker_loads_the_shared_brief_with_read_only_tools(self):
        agent = (ROOT / "claude/agents/bulk-reader.md").read_text()
        self.assertIn("model: haiku\n", agent)
        self.assertIn("tools: Read, Grep, Glob\n", agent)
        self.assertIn("~/.claude/skills/bulk-read/BULK-READER.md", agent)
        self.assertTrue((ROOT / "shared/skills/bulk-read/BULK-READER.md").is_file())


if __name__ == "__main__":
    unittest.main()
