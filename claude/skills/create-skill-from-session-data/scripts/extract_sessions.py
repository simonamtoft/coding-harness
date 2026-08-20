#!/usr/bin/env python3
"""Extract recent user prompts from Claude Code and Cursor session stores.

Emits one JSON object per line on stdout:
    {"source": "claude"|"cursor", "ts": ISO8601, "cwd": "...", "prompt": "..."}

Stderr gets a one-line summary.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

HOME = Path.home()
CLAUDE_PROJECTS = HOME / ".claude" / "projects"
CURSOR_DB = HOME / "Library" / "Application Support" / "Cursor" / "User" / "globalStorage" / "state.vscdb"


def _flatten_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                # ONLY genuine text blocks are user prose. tool_result, tool_use,
                # and image blocks are not prompts — never pull their payloads in,
                # or the stream fills with "File created successfully…", task-status
                # updates, and command output instead of what the user typed.
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    parts.append(block["text"])
        return "\n".join(p for p in parts if p)
    return ""


# Harness-injected blocks that ride along inside an otherwise-real user turn.
# Stripped before the prompt is kept, so trailing context doesn't pollute clustering.
_RIDEALONG_BLOCKS = re.compile(
    r"<(system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|"
    r"bash-input|bash-stdout|bash-stderr|command-name|command-message|command-args|"
    r"task-notification)>"
    r".*?</\1>",
    re.DOTALL,
)

# A user turn whose (cleaned) text starts with one of these is not a typed prompt —
# it's a synthetic message the harness delivers through the user role.
_SYNTHETIC_PREFIXES = (
    "<system-reminder>",
    "<local-command-caveat>",
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<local-command-stdout>",
    "<bash-input>",
    "<bash-stdout>",
    "<bash-stderr>",
    "<task-notification>",
    "Base directory for this skill",
    "Caveat:",
    "[Request interrupted",
    "The user doesn't want to proceed",
    "User has approved your plan",
    "Your plan has been saved",
    "This session is being continued",
    "API Error",
)


def _clean_prompt(text: str) -> str:
    """Strip ride-along harness blocks, leaving only what the user actually typed."""
    if not text:
        return ""
    return _RIDEALONG_BLOCKS.sub("", text).strip()


def _looks_like_real_prompt(text: str) -> bool:
    if not text or not text.strip():
        return False
    stripped = text.lstrip()
    return not stripped.startswith(_SYNTHETIC_PREFIXES)


def extract_claude(cutoff: datetime) -> Iterator[dict]:
    if not CLAUDE_PROJECTS.exists():
        return
    for jsonl in CLAUDE_PROJECTS.glob("*/*.jsonl"):
        try:
            mtime = datetime.fromtimestamp(jsonl.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        if mtime < cutoff:
            continue
        cwd_hint = jsonl.parent.name
        try:
            with jsonl.open("r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if rec.get("type") != "user":
                        continue
                    msg = rec.get("message") or {}
                    if msg.get("role") != "user":
                        continue
                    text = _clean_prompt(_flatten_content(msg.get("content")))
                    if not _looks_like_real_prompt(text):
                        continue
                    ts = rec.get("timestamp")
                    try:
                        ts_dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else mtime
                    except (AttributeError, ValueError):
                        ts_dt = mtime
                    if ts_dt < cutoff:
                        continue
                    yield {
                        "source": "claude",
                        "ts": ts_dt.astimezone(timezone.utc).isoformat(),
                        "cwd": rec.get("cwd") or cwd_hint,
                        "prompt": text,
                    }
        except OSError:
            continue


def _cursor_bubble_text(value: dict) -> str | None:
    # Cursor's bubble schema shifts between versions. Try the common fields.
    for key in ("text", "richText", "content"):
        v = value.get(key)
        if isinstance(v, str) and v.strip():
            return v
    # Some versions wrap content in a list of parts.
    parts = value.get("parts") or value.get("contentParts")
    if isinstance(parts, list):
        chunks = []
        for p in parts:
            if isinstance(p, dict):
                t = p.get("text") or p.get("content")
                if isinstance(t, str):
                    chunks.append(t)
            elif isinstance(p, str):
                chunks.append(p)
        joined = "\n".join(c for c in chunks if c)
        if joined.strip():
            return joined
    return None


def _cursor_is_user(value: dict) -> bool:
    # Cursor uses type=1 for user, type=2 for assistant in some versions;
    # newer versions use role="user"/"assistant".
    role = value.get("role")
    if isinstance(role, str):
        return role.lower() == "user"
    t = value.get("type")
    if isinstance(t, int):
        return t == 1
    return False


def _cursor_timestamp(value: dict, fallback: datetime) -> datetime:
    for key in ("createdAt", "timestamp", "time", "ts"):
        v = value.get(key)
        if isinstance(v, (int, float)):
            # Cursor uses ms epoch.
            try:
                return datetime.fromtimestamp(v / 1000 if v > 1e12 else v, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                continue
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                continue
    return fallback


def extract_cursor(cutoff: datetime) -> Iterator[dict]:
    if not CURSOR_DB.exists():
        return
    uri = f"file:{CURSOR_DB}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as e:
        print(f"warning: could not open cursor db: {e}", file=sys.stderr)
        return
    try:
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
        for key, raw in cur:
            try:
                value = json.loads(raw) if isinstance(raw, (str, bytes)) else None
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(value, dict):
                continue
            try:
                if not _cursor_is_user(value):
                    continue
                text = _clean_prompt(_cursor_bubble_text(value) or "")
                if not _looks_like_real_prompt(text):
                    continue
                ts_dt = _cursor_timestamp(value, fallback=cutoff)
                if ts_dt < cutoff:
                    continue
                yield {
                    "source": "cursor",
                    "ts": ts_dt.astimezone(timezone.utc).isoformat(),
                    "cwd": value.get("workspaceId") or value.get("workspaceRoot") or "",
                    "prompt": text,
                }
            except KeyError:
                continue
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=7, help="Lookback window in days (default: 7)")
    ap.add_argument(
        "--source",
        choices=("claude", "cursor", "both"),
        default="both",
        help="Which session store to read (default: both)",
    )
    args = ap.parse_args()

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=args.days)

    n_claude = n_cursor = 0
    if args.source in ("claude", "both"):
        for rec in extract_claude(cutoff):
            print(json.dumps(rec, ensure_ascii=False))
            n_claude += 1
    if args.source in ("cursor", "both"):
        for rec in extract_cursor(cutoff):
            print(json.dumps(rec, ensure_ascii=False))
            n_cursor += 1

    print(
        f"extracted {n_claude} claude prompts, {n_cursor} cursor prompts, window={args.days}d",
        file=sys.stderr,
    )

    if n_claude == 0 and n_cursor == 0:
        print(
            f"error: no prompts found. Checked:\n"
            f"  - {CLAUDE_PROJECTS}\n"
            f"  - {CURSOR_DB}\n"
            f"Try a wider --days window or confirm the paths exist.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
