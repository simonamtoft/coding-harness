#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import overhead as O


def usage(output, reasoning=0, input_tokens=10):
    return {"input": input_tokens, "output": output, "reasoning": reasoning, "cacheRead": 0, "cacheWrite": 0}


def assistant(content, stop="toolUse", usage_value=None):
    message = {"role": "assistant", "content": content, "stopReason": stop}
    if usage_value is not None:
        message["usage"] = usage_value
    return {"type": "message", "message": message}


def tool_result(name, text, details=None):
    return {"type": "message", "message": {
        "role": "toolResult", "toolName": name, "content": [{"type": "text", "text": text}], "details": details or {}}}


def report(records):
    o = O.Overhead()
    O.add_records(o, records)
    return O.build_report(o)


class OutputSplitTests(unittest.TestCase):
    def test_visible_output_splits_by_character_share_and_message_role(self):
        call = {"type": "toolCall", "name": "bash", "arguments": {"command": "ls"}}  # 4 + 17 chars
        r = report([
            assistant([{"type": "thinking", "thinking": "x"}, {"type": "text", "text": "a" * 21}, call],
                      usage_value=usage(52, reasoning=10)),
            assistant([{"type": "text", "text": "Done."}], stop="stop", usage_value=usage(7, reasoning=2)),
        ])
        self.assertEqual(r["output_tokens"], 59)
        self.assertEqual(r["reasoning_tokens"], 12)
        self.assertEqual(r["buckets"]["between_tool_calls"], 21)
        self.assertEqual(r["buckets"]["tool_call_args"], 21)
        self.assertEqual(r["buckets"]["final_message"], 5)
        self.assertEqual(r["median_tokens_per_message"], {"between_tool_calls": 21, "final_message": 5})

    def test_missing_usage_is_counted_as_missing_not_zero(self):
        text = [{"type": "text", "text": "partial"}]
        zero = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
        r = report([
            assistant(text, stop="error", usage_value=zero),
            assistant(text, stop="aborted"),
            assistant(text, stop="stop", usage_value={"input": 5}),
        ])
        self.assertEqual(r["missing_usage_messages"], 3)
        self.assertEqual(r["output_tokens"], 0)
        self.assertEqual(r["median_tokens_per_message"]["final_message"], None)
        self.assertEqual(r["final_messages"]["opener_or_closer_rate"], 0.0)
        self.assertIsNone(r["visible_share"]["final_message"])

    def test_unreported_reasoning_is_unattributed_rather_than_visible(self):
        r = report([assistant([{"type": "thinking", "thinking": "hm"}, {"type": "text", "text": "x"}],
                              stop="stop", usage_value={"input": 3, "output": 40})])
        self.assertEqual(r["buckets"]["unattributed"], 40)
        self.assertEqual(r["visible_output_tokens"], 0)

    def test_text_in_failed_turn_is_other_text(self):
        r = report([assistant([{"type": "text", "text": "abc"}], stop="length", usage_value=usage(3))])
        self.assertEqual(r["buckets"]["other_text"], 3)
        self.assertEqual(r["final_messages"]["count"], 0)


class FinalMessageRuleTests(unittest.TestCase):
    def test_opener_and_closer_rules(self):
        cases = {
            "I'll start by checking the config. It is fine.": (True, False),
            "## Let me summarize\nThe test passed.": (True, False),
            "The fix is in `a.py`. Let me know if you want more.": (False, True),
            "Changed `a.py`.\n\nIn summary, the bug is fixed.": (False, True),
            "Changed `a.py`. Want me to also update the docs?": (False, True),
            "The parser rejects empty input.\n\n```\nok\n```": (False, False),
            "Overall cost fell 3%. Tests pass.": (False, False),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(O.classify_final(text), expected)

    def test_rate_counts_final_messages_only(self):
        r = report([
            assistant([{"type": "text", "text": "Let me check."}, {"type": "toolCall", "name": "read", "arguments": {}}],
                      usage_value=usage(10)),
            assistant([{"type": "text", "text": "Fixed. Let me know if needed."}], stop="stop", usage_value=usage(8)),
            assistant([{"type": "text", "text": "Fixed."}], stop="stop", usage_value=usage(2)),
        ])
        self.assertEqual(r["final_messages"], {
            "count": 2, "opener": 0, "closer": 1, "opener_or_closer": 1, "opener_or_closer_rate": 0.5})


class ToolResultTests(unittest.TestCase):
    def test_subagent_results_are_attributed_per_agent(self):
        parallel = "Parallel: 2/2 succeeded\n\n### [repository-scout] completed\n\nabcd\n\n---\n\n### [bulk-reader] completed\n\nxy"
        r = report([
            tool_result("subagent", "a" * 400, {"mode": "single", "results": [{"agent": "bulk-reader"}]}),
            tool_result("subagent", parallel, {"mode": "parallel", "results": [
                {"agent": "repository-scout"}, {"agent": "bulk-reader"}]}),
        ])
        agents = r["subagent_parent_context_estimated_tokens"]
        self.assertEqual(agents["bulk-reader"]["calls"], 2)
        self.assertEqual(agents["repository-scout"]["calls"], 1)
        scout_section = parallel[parallel.index("### [repository"):parallel.index("### [bulk")]
        self.assertEqual(agents["repository-scout"]["estimated_tokens"], round(len(scout_section) / 4))

    def test_codemode_subagent_calls_are_counted_but_not_attributed(self):
        code = {"code": "return await tools.subagent({agent: 'bulk-reader', task: 't'})"}
        r = report([assistant([{"type": "toolCall", "name": "codemode", "arguments": code}], usage_value=usage(5))])
        self.assertEqual(r["codemode_calls_invoking_subagent_unattributed"], 1)
        self.assertEqual(r["subagent_parent_context_estimated_tokens"], {})

    def test_bash_limiter_truncations_are_counted_with_sizes(self):
        limited = "tail\n\n[Bash output truncated: 50000 bytes; full output: /tmp/x/bash-output-1.txt]"
        r = report([tool_result("bash", "ok"), tool_result("bash", limited)])
        self.assertEqual(r["bash_limiter"]["bash_results"], 2)
        self.assertEqual(r["bash_limiter"]["truncated"], 1)
        self.assertEqual(r["bash_limiter"]["original_bytes_total"], 50000)
        self.assertEqual(r["bash_limiter"]["retained_bytes_total"], len(limited))


if __name__ == "__main__":
    unittest.main()
