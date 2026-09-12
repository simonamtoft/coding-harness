#!/usr/bin/env python3
"""PreToolUse file-size routing; never grants permissions or returns file contents."""

import json
import os
from pathlib import Path
import stat
import sys

MAX_BOUNDED_READ_LINES = 350
MAX_DIRECT_BYTES = 16 * 1024
GOVERNING_NAMES = {
    "agents.md", "claude.md", "claude.local.md", "skill.md", "system.md", "append_system.md",
    "context.md", "context-map.md", "decisions.md",
}
GOVERNING_DIRS = {"skills", "agents", "adr", "adrs", "decisions"}
NATIVE_DOCUMENT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".pdf", ".ipynb"}


def is_direct_document(path: Path) -> bool:
    if path.suffix.lower() in NATIVE_DOCUMENT_EXTENSIONS or path.name.lower() in GOVERNING_NAMES:
        return True
    if path.suffix.lower() != ".md":
        return False
    parts = tuple(part.lower() for part in path.parts)
    return bool(GOVERNING_DIRS.intersection(parts[:-1])) or any(
        part == ".claude" and parts[index + 1] == "rules"
        for index, part in enumerate(parts[:-1])
    )


def should_route(payload: object) -> bool:
    if not isinstance(payload, dict) or payload.get("tool_name") != "Read":
        return False
    # agent_type alone also identifies a top-level --agent session.
    if isinstance(payload.get("agent_id"), str) and payload["agent_id"]:
        return False
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return False
    limit = tool_input.get("limit")
    if type(limit) is int and 0 < limit <= MAX_BOUNDED_READ_LINES:
        return False
    file_path = tool_input.get("file_path")
    cwd = payload.get("cwd")
    if not isinstance(file_path, str) or not file_path:
        return False
    try:
        path = Path(file_path).expanduser()
        if not path.is_absolute():
            if not isinstance(cwd, str) or not os.path.isabs(cwd):
                return False
            path = Path(cwd) / path
        if is_direct_document(path):
            return False
        canonical_path = path.resolve(strict=True)
        if is_direct_document(canonical_path):
            return False
        info = canonical_path.stat()
        return stat.S_ISREG(info.st_mode) and info.st_size > MAX_DIRECT_BYTES
    except (OSError, ValueError, RuntimeError):
        return False


def main() -> int:
    if os.environ.get("CLAUDE_HOOK_DISABLE") == "1":
        return 0
    try:
        payload = json.load(sys.stdin)
    except (ValueError, UnicodeError):
        return 0
    if not should_route(payload):
        return 0
    skill = Path.home() / ".claude/skills/bulk-read/SKILL.md"
    print(
        f"Bulk read routed: this file exceeds {MAX_DIRECT_BYTES // 1024} KiB. "
        f"Read {skill} and delegate extraction "
        "to bulk-reader with the paths and a specific question. If you need original source "
        f"for reasoning or editing, use Read with offset and limit (1–{MAX_BOUNDED_READ_LINES} lines). "
        "Offset alone is not bounded. Do not bypass via Bash or oversized limits. "
        "Security checks still apply.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
