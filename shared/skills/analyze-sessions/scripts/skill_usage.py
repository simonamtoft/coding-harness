#!/usr/bin/env python3
"""Count how often each Pi skill is loaded in past sessions.

A skill counts as used in a session when either:
  - the user invokes it explicitly: `/skill:name` expands to a user message
    that starts with `<skill name="name" location="...">`, or
  - the model loads it: a `read` tool call targets `<skill location>/name/SKILL.md`.
Reads of other files inside the skill directory are counted as resource reads.

Skill locations are Pi's discovery roots (`~/.pi/agent/skills`, `.pi/skills`,
`~/.agents/skills`, `.agents/skills`). Reads of a skill's source checkout, such
as `shared/skills/...` while editing it, are maintenance and are not counted.

Examples:
  python3 skill_usage.py --since 30d
  python3 skill_usage.py --since 90d --cwd coding-harness
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import sessions as S


INSTALLED_SKILLS_ROOT = Path("~/.pi/agent/skills").expanduser()
_EXPLICIT_RE = re.compile(r'^\s*<skill name="([^"]+)"')
_SKILL_FILE_RE = re.compile(r"(?:^|/)(?:\.pi/agent/skills|\.pi/skills|\.agents/skills)/([^/]+)/(.+)$")


@dataclass
class SkillUsage:
    session_ids: set = field(default_factory=set)
    explicit: int = 0
    model_loads: int = 0
    resource_reads: int = 0
    last_used: Optional[datetime] = None

    def mark_session(self, summary: S.SessionSummary) -> None:
        self.session_ids.add(summary.id)
        if summary.started_at and (self.last_used is None or summary.started_at > self.last_used):
            self.last_used = summary.started_at


def add_session(usage: dict, summary: S.SessionSummary) -> None:
    for rec in S.iter_records(summary.path):
        if rec.get("type") != "message":
            continue
        message = rec.get("message") or {}
        role = message.get("role")
        if role == "user":
            match = _EXPLICIT_RE.match(S._extract_text(message.get("content")))
            if match:
                entry = usage.setdefault(match.group(1), SkillUsage())
                entry.explicit += 1
                entry.mark_session(summary)
        elif role == "assistant":
            for content in message.get("content") or []:
                if content.get("type") != "toolCall" or content.get("name") != "read":
                    continue
                path = (content.get("arguments") or {}).get("path") or ""
                match = _SKILL_FILE_RE.search(path)
                if not match:
                    continue
                entry = usage.setdefault(match.group(1), SkillUsage())
                if match.group(2) == "SKILL.md":
                    entry.model_loads += 1
                    entry.mark_session(summary)
                else:
                    entry.resource_reads += 1


def installed_skills(root: Path = INSTALLED_SKILLS_ROOT) -> set:
    if not root.is_dir():
        return set()
    return {entry.name for entry in root.iterdir() if (entry / "SKILL.md").is_file()}


def render(usage: dict, installed: set, scanned: int) -> str:
    lines = [f"# Skill usage across {scanned} session(s)"]
    header = f"{'skill':<32} {'sessions':>8} {'explicit':>8} {'loads':>6} {'resources':>9}  last used"
    lines += [header, "-" * len(header)]
    rows = sorted(usage.items(), key=lambda item: (-len(item[1].session_ids), item[0]))
    for name, entry in rows:
        last = entry.last_used.astimezone().strftime("%Y-%m-%d") if entry.last_used else "never"
        lines.append(f"{name:<32} {len(entry.session_ids):>8} {entry.explicit:>8} "
                     f"{entry.model_loads:>6} {entry.resource_reads:>9}  {last}")
    unused = sorted(name for name in installed if not usage.get(name, SkillUsage()).session_ids)
    not_installed = sorted(name for name in usage if name not in installed)
    lines.append("")
    lines.append(f"# Installed, not loaded in scope ({len(unused)}): {', '.join(unused) or '-'}")
    lines.append(f"# Seen but not installed now ({len(not_installed)}): {', '.join(not_installed) or '-'}")
    return "\n".join(lines)


def main() -> int:
    p = argparse.ArgumentParser(description="Count Pi skill loads per skill.")
    S.add_filter_args(p, subagents_default=False)
    args = p.parse_args()
    summaries = S.load_summaries(S.filters_from_args(args, subagents_default=False))
    usage: dict = {}
    for summary in summaries:
        add_session(usage, summary)
    print(render(usage, installed_skills(), len(summaries)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
