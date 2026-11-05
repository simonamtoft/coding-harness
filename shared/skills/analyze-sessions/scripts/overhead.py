#!/usr/bin/env python3
"""Where assistant output and parent context go in Pi sessions.

Reports, for the filtered sessions:
  - assistant output tokens split into reasoning, text between tool calls,
    final-message text, other text, and tool-call arguments
  - the rate of final messages that open by announcing a plan or close with a
    recap or offer (rules: OPENER_RE / CLOSER_RE below)
  - estimated parent-context tokens returned by subagent results, per agent
  - Bash results truncated by the bash-result-limiter extension

Examples:
  python3 overhead.py --since 30d
  python3 overhead.py --since 2026-10-01 --until 2026-10-31 --cwd coding-harness --json
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Optional

import sessions as S


CHARS_PER_TOKEN = 4  # estimate for tool results, which carry no token count

# Applied to the first sentence of a final message after stripping Markdown markers.
OPENER_RE = re.compile(
    r"^(i'll|i will|i'm going to|i am going to|let me|let's|"
    r"(first|now|next),? i('ll| will)|here's (what|how) i('ll| will))\b",
    re.IGNORECASE,
)
# Applied to the last sentence: an offer anywhere in it, or a recap lead-in at its start.
CLOSER_RE = re.compile(
    r"\b(let me know|if you('d| would)? like|if you want|want me to|would you like|"
    r"do you want me|happy to|feel free|i can also|i could also)\b"
    r"|^(in summary|to summarize|to sum up|in short|overall|tl;dr)\b",
    re.IGNORECASE,
)
LIMITER_MARKER_RE = re.compile(r"\[Bash output truncated: (\d+) bytes; full output: [^\]]+\]\s*$")
PARALLEL_SECTION_RE = re.compile(r"^### \[([^\]]+)\] ", re.MULTILINE)

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
MARKDOWN_LEAD_RE = re.compile(r"^[\s#>*_`-]+|^\d+[.)]\s+")
HAS_WORD_RE = re.compile(r"\w")

BUCKETS = ("between_tool_calls", "final_message", "other_text", "tool_call_args", "unattributed")


@dataclass
class Overhead:
    sessions: int = 0
    assistant_messages: int = 0
    missing_usage: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    buckets: dict = field(default_factory=lambda: dict.fromkeys(BUCKETS, 0.0))
    between_per_message: list = field(default_factory=list)
    final_per_message: list = field(default_factory=list)
    final_messages: int = 0
    openers: int = 0
    closers: int = 0
    opener_or_closer: int = 0
    subagent_calls: dict = field(default_factory=lambda: defaultdict(int))
    subagent_chars: dict = field(default_factory=lambda: defaultdict(int))
    codemode_subagent_calls: int = 0
    bash_results: int = 0
    limited_original_bytes: list = field(default_factory=list)
    limited_retained_bytes: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def usage_tokens(usage) -> Optional[tuple[int, Optional[int]]]:
    """Return (output, reasoning) or None when the provider reported no usage.

    Usage counts as missing when `output` is absent or non-numeric, or when every
    token count is zero; failed and aborted requests record all-zero usage, and a
    real completion always consumes input. `reasoning` is None when not reported.
    """
    if not isinstance(usage, dict) or not isinstance(usage.get("output"), (int, float)):
        return None
    counts = [usage.get(k) for k in ("input", "output", "cacheRead", "cacheWrite")]
    if not any(isinstance(c, (int, float)) and c > 0 for c in counts):
        return None
    reasoning = usage.get("reasoning")
    return int(usage["output"]), int(reasoning) if isinstance(reasoning, (int, float)) else None


def text_bucket(message: dict, has_tool_call: bool) -> str:
    if has_tool_call:
        return "between_tool_calls"
    if message.get("stopReason") == "stop":
        return "final_message"
    return "other_text"


def sentences(text: str) -> list[str]:
    out = []
    for part in SENTENCE_SPLIT_RE.split(text):
        part = MARKDOWN_LEAD_RE.sub("", part.strip()).strip()
        if HAS_WORD_RE.search(part):
            out.append(part)
    return out


def classify_final(text: str) -> tuple[bool, bool]:
    """Return (opens with a plan announcement, closes with a recap or offer)."""
    parts = sentences(text)
    if not parts:
        return False, False
    return bool(OPENER_RE.search(parts[0])), bool(CLOSER_RE.search(parts[-1]))


def add_assistant(o: Overhead, message: dict) -> None:
    o.assistant_messages += 1
    content = [c for c in message.get("content") or [] if isinstance(c, dict)]
    text = "\n".join(c.get("text") or "" for c in content if c.get("type") == "text").strip()
    tool_chars = sum(
        len(c.get("name") or "") + len(json.dumps(c.get("arguments") or {}))
        for c in content if c.get("type") == "toolCall"
    )
    has_tool_call = any(c.get("type") == "toolCall" for c in content)
    # Subagent output returned through codemode is mixed into the script's own result.
    o.codemode_subagent_calls += sum(
        1 for c in content
        if c.get("type") == "toolCall" and c.get("name") == "codemode"
        and "tools.subagent(" in json.dumps(c.get("arguments") or {})
    )
    bucket = text_bucket(message, has_tool_call)

    if bucket == "final_message" and text:
        o.final_messages += 1
        opener, closer = classify_final(text)
        o.openers += opener
        o.closers += closer
        o.opener_or_closer += opener or closer

    tokens = usage_tokens(message.get("usage"))
    if tokens is None:
        o.missing_usage += 1
        return
    output, reasoning = tokens
    o.output_tokens += output
    if reasoning is None:
        o.buckets["unattributed"] += output
        return
    o.reasoning_tokens += reasoning
    visible = max(0, output - reasoning)
    total_chars = len(text) + tool_chars
    if total_chars == 0:
        o.buckets["unattributed"] += visible
        return
    text_tokens = visible * len(text) / total_chars
    o.buckets[bucket] += text_tokens
    o.buckets["tool_call_args"] += visible - text_tokens
    if text and bucket == "between_tool_calls":
        o.between_per_message.append(text_tokens)
    elif text and bucket == "final_message":
        o.final_per_message.append(text_tokens)


def result_text(message: dict) -> str:
    return "".join(
        c.get("text") or "" for c in message.get("content") or []
        if isinstance(c, dict) and c.get("type") == "text"
    )


def add_subagent_result(o: Overhead, message: dict) -> None:
    details = message.get("details") or {}
    results = [r for r in details.get("results") or [] if isinstance(r, dict)]
    text = result_text(message)
    if details.get("mode") == "parallel":
        for r in results:
            o.subagent_calls[r.get("agent") or "?"] += 1
        starts = list(PARALLEL_SECTION_RE.finditer(text))
        for i, m in enumerate(starts):
            end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
            o.subagent_chars[m.group(1)] += end - m.start()
        return
    # Single and chain modes return only the last result's output.
    agent = results[-1].get("agent") if results else None
    agent = agent or "?"
    o.subagent_calls[agent] += 1
    o.subagent_chars[agent] += len(text)


def add_bash_result(o: Overhead, message: dict) -> None:
    o.bash_results += 1
    text = result_text(message)
    marker = LIMITER_MARKER_RE.search(text)
    if marker:
        o.limited_original_bytes.append(int(marker.group(1)))
        o.limited_retained_bytes.append(len(text.encode("utf-8")))


def add_records(o: Overhead, records: Iterable[dict]) -> None:
    o.sessions += 1
    for rec in records:
        if rec.get("type") != "message":
            continue
        message = rec.get("message") or {}
        role = message.get("role")
        if role == "assistant":
            add_assistant(o, message)
        elif role == "toolResult" and message.get("toolName") == "subagent":
            add_subagent_result(o, message)
        elif role == "toolResult" and message.get("toolName") == "bash":
            add_bash_result(o, message)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _median(values: list) -> Optional[float]:
    return round(statistics.median(values), 1) if values else None


def _rate(n: int, d: int) -> Optional[float]:
    return round(n / d, 4) if d else None


def build_report(o: Overhead) -> dict:
    visible = sum(o.buckets[b] for b in BUCKETS if b != "unattributed")
    return {
        "sessions": o.sessions,
        "assistant_messages": o.assistant_messages,
        "missing_usage_messages": o.missing_usage,
        "output_tokens": o.output_tokens,
        "reasoning_tokens": o.reasoning_tokens,
        "visible_output_tokens": round(visible),
        "buckets": {b: round(v) for b, v in o.buckets.items()},
        "visible_share": {b: _rate(round(o.buckets[b]), round(visible))
                          for b in BUCKETS if b != "unattributed"},
        "median_tokens_per_message": {
            "between_tool_calls": _median(o.between_per_message),
            "final_message": _median(o.final_per_message),
        },
        "final_messages": {
            "count": o.final_messages,
            "opener": o.openers,
            "closer": o.closers,
            "opener_or_closer": o.opener_or_closer,
            "opener_or_closer_rate": _rate(o.opener_or_closer, o.final_messages),
        },
        "subagent_parent_context_estimated_tokens": {
            agent: {"calls": o.subagent_calls[agent],
                    "estimated_tokens": round(o.subagent_chars[agent] / CHARS_PER_TOKEN)}
            for agent in sorted(o.subagent_calls, key=lambda a: -o.subagent_chars[a])
        },
        "codemode_calls_invoking_subagent_unattributed": o.codemode_subagent_calls,
        "bash_limiter": {
            "bash_results": o.bash_results,
            "truncated": len(o.limited_original_bytes),
            "original_bytes_total": sum(o.limited_original_bytes),
            "original_bytes_median": _median(o.limited_original_bytes),
            "original_bytes_max": max(o.limited_original_bytes, default=None),
            "retained_bytes_total": sum(o.limited_retained_bytes),
        },
    }


def _pct(x: Optional[float]) -> str:
    return "n/a" if x is None else f"{x * 100:.1f}%"


def print_report(r: dict) -> None:
    print(f"Sessions: {r['sessions']}   assistant messages: {r['assistant_messages']}"
          f"   missing usage: {r['missing_usage_messages']} (excluded from token sums)")
    print(f"Output tokens: {r['output_tokens']:,}   reasoning {r['reasoning_tokens']:,}"
          f"   visible {r['visible_output_tokens']:,}"
          f"   unattributed {r['buckets']['unattributed']:,}")
    print("\nVisible output split (estimated by character share within each message):")
    for b in BUCKETS[:-1]:
        print(f"  {b:<20} {r['buckets'][b]:>10,}  {_pct(r['visible_share'][b]):>6}")
    med = r["median_tokens_per_message"]
    print(f"  median per message: between_tool_calls {med['between_tool_calls']}"
          f"   final_message {med['final_message']}")
    f = r["final_messages"]
    print(f"\nFinal messages: {f['count']}   opener {f['opener']}   closer {f['closer']}"
          f"   either {f['opener_or_closer']} ({_pct(f['opener_or_closer_rate'])})")
    print(f"\nSubagent results in parent context (chars/{CHARS_PER_TOKEN} estimate):")
    for agent, v in r["subagent_parent_context_estimated_tokens"].items():
        print(f"  {agent:<22} calls {v['calls']:>4}   ~{v['estimated_tokens']:,} tokens")
    print(f"  codemode calls invoking subagent (not attributed): "
          f"{r['codemode_calls_invoking_subagent_unattributed']}")
    b = r["bash_limiter"]
    print(f"\nBash results: {b['bash_results']}   truncated by limiter: {b['truncated']}"
          f"   original bytes total {b['original_bytes_total']:,}"
          f" (median {b['original_bytes_median']}, max {b['original_bytes_max']})"
          f"   retained bytes total {b['retained_bytes_total']:,}")


def main() -> int:
    p = argparse.ArgumentParser(description="Assistant output and parent-context overhead in Pi sessions.")
    p.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    S.add_filter_args(p, subagents_default=False)
    args = p.parse_args()
    if not args.since and not args.until and not args.session:
        args.since = "30d"

    overhead = Overhead()
    for summary in S.load_summaries(S.filters_from_args(args, subagents_default=False)):
        add_records(overhead, S.iter_records(summary.path))
    if overhead.sessions == 0:
        S.stderr("No sessions matched.")
        return 0

    report = build_report(overhead)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_report(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
