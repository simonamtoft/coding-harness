#!/usr/bin/env python3
"""Stop hook: flag broken file references in CLAUDE.md package maps.

CLAUDE.md files describe a directory's layout by naming files in backticks
(``routes/me.py``, ``VerdictBar.tsx``). Those maps drift when files are renamed
or deleted but the doc isn't updated. This hook is the *deterministic* half of
drift detection: it scans every CLAUDE.md at/below the scan root, extracts
backticked filename tokens, and reports any that no longer resolve to a real
file. (Stale *prose* — "step 6 in progress" after step 6 landed — is not
mechanically checkable and is left to the CI prose audit.)

Design mirrors the sibling hooks:
  - honors CLAUDE_HOOK_DISABLE=1 (session bypass)
  - default-noop where there's nothing to check (no CLAUDE.md under the root)
  - fires at most ONCE per session (a sentinel keyed by session_id), so an
    unaddressed / unrelated drift doesn't nag on every turn
  - on findings, prints the report on stderr and exit 2, so Claude sees the
    concrete broken refs and can fix the doc before finishing.

Conservative by construction — false positives train you to ignore it:
  - placeholder tokens (``step_N.py``, globs, ranges) are skipped
  - a token resolves if it exists at the path OR its basename exists anywhere
    under the root, so a doc that names a file by basename never false-flags.
Net effect: it catches the "named file doesn't exist at all" class (the
VerdictBar case) and stays quiet otherwise.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

if os.environ.get("CLAUDE_HOOK_DISABLE") == "1":
    sys.exit(0)

# Scan root: an explicit CLI arg (handy for manual runs / CI) wins, else the
# project dir Claude is working in, else cwd.
ROOT = Path(
    sys.argv[1] if len(sys.argv) > 1
    else (os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
)

SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", ".next", ".turbo",
    "target", ".idea", ".vscode",
}

# Extensions we treat as "this backtick token names a source file".
_EXT = (
    "py|tsx|ts|jsx|js|mjs|cjs|css|scss|svg|yml|yaml|json|toml|md|rs|go|java|"
    "rb|sh|sql|html|ini|cfg"
)
_TOKEN_RE = re.compile(r"`([~\w./-]+\.(?:" + _EXT + r"))`")


# Filenames named generically as examples (e.g. "don't hand-edit generated
# files like `pyproject.toml`"), not as real refs into the tree.
IGNORE_NAMES = {"pyproject.toml", "package.json"}


def is_placeholder(tok: str) -> bool:
    """Skip tokens that are patterns/examples, not real filenames."""
    if any(c in tok for c in "*?<>{}…"):
        return True
    if Path(tok).name in IGNORE_NAMES:
        return True
    stem = Path(tok).stem
    # convention: step_N.py / stepN.py etc. are patterns, not files
    return stem.endswith("N")


def build_index(root: Path) -> tuple[set[str], set[Path]]:
    """One walk: set of basenames and set of dir-relative paths under root."""
    names: set[str] = set()
    rel_paths: set[Path] = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        base = Path(dirpath)
        for f in filenames:
            names.add(f)
            try:
                rel_paths.add((base / f).relative_to(root))
            except ValueError:
                pass
    return names, rel_paths


def main() -> int:
    if not ROOT.is_dir():
        return 0

    names, _ = build_index(ROOT)

    # Collect CLAUDE.md files under the root (skipping vendored trees).
    md_files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if "CLAUDE.md" in filenames:
            md_files.append(Path(dirpath) / "CLAUDE.md")
    if not md_files:
        return 0  # nothing to check -> no-op

    def resolves(tok: str, md_dir: Path) -> bool:
        tok = tok.lstrip("~")
        if "/" in tok:
            if (md_dir / tok).exists() or (ROOT / tok).exists():
                return True
            return Path(tok).name in names  # basename fallback (conservative)
        return tok in names

    broken: dict[Path, set[str]] = {}
    for md in md_files:
        try:
            text = md.read_text(errors="ignore")
        except OSError:
            continue
        for m in _TOKEN_RE.finditer(text):
            tok = m.group(1)
            if is_placeholder(tok):
                continue
            if not resolves(tok, md.parent):
                broken.setdefault(md, set()).add(tok)

    if not broken:
        return 0

    # Fire at most once per session so an unaddressed drift doesn't nag.
    session_id = "nosession"
    try:
        payload = json.load(sys.stdin)
        session_id = str(payload.get("session_id") or "nosession")
    except (json.JSONDecodeError, ValueError):
        pass
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", session_id)
    sentinel = Path(os.environ.get("TMPDIR", "/tmp")) / f"claude-md-refcheck-{safe}"
    if sentinel.exists():
        return 0
    try:
        sentinel.write_text("1")
    except OSError:
        pass

    lines = ["Hook: CLAUDE.md references files that don't exist (package-map drift):"]
    for md in sorted(broken):
        try:
            rel = md.relative_to(ROOT)
        except ValueError:
            rel = md
        lines.append(f"  {rel}:")
        for tok in sorted(broken[md]):
            lines.append(f"    - `{tok}`")
    lines.append(
        "Verify against the actual tree and update the doc (or tell the user if "
        "intentional). Surfaced once per session."
    )
    print("\n".join(lines), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
