#!/usr/bin/env python3
"""Report Markdown references to repository paths, package scripts and make targets that do not exist.

Checks link targets, inline code spans that look like repository paths, and
`npm|pnpm|yarn|bun run <script>` and `make <target>` commands inside code spans
and fenced blocks. Output lines are candidates for documentation drift, not verdicts.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

from repo_files import list_files, read_text, relative

_DOC_SUFFIXES = {".md", ".mdx"}
_FENCE = re.compile(r"^\s*(```|~~~)")
_CODE_SPAN = re.compile(r"`([^`\n]+)`")
_LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+[\"'][^\"']*[\"'])?\s*\)")
# A flag after `run` (such as --workspace) makes the script position ambiguous, so it is not checked.
_SCRIPT_RUN = re.compile(r"\b(?:npm|pnpm|yarn|bun) run ([A-Za-z0-9_][\w:.\-]*)")
_MAKE = re.compile(r"(?:^|[\s`;&|(])make ([A-Za-z0-9_][\w.\-]*)")
_MAKE_TARGET = re.compile(r"^([A-Za-z0-9_][\w.\-/ ]*?)\s*::?(?!=)", re.MULTILINE)
_SCHEME = re.compile(r"^[A-Za-z][\w+.-]*:")
_LINE_SUFFIX = re.compile(r"(:\d+([-–]\d+)?|#L\d+(-L?\d+)?)$")
_NOT_A_PATH_CHARS = set("*?[]{}<>$|\"'")


def _nearest(start: Path, root: Path, name: str) -> Path | None:
    for directory in (start, *start.parents):
        if (directory / name).is_file():
            return directory / name
        if directory == root:
            return None
    return None


def _package_scripts(package_json: Path) -> set[str]:
    try:
        return set(json.loads(package_json.read_text()).get("scripts", {}))
    except (OSError, ValueError):
        return set()


def _make_targets(makefile: Path) -> set[str]:
    targets = set()
    for match in _MAKE_TARGET.finditer(read_text(makefile) or ""):
        targets.update(match.group(1).split())
    return targets


def _exists(target: str, doc_dir: Path, root: Path) -> bool:
    if target.startswith("/"):
        return (root / target.lstrip("/")).exists()
    return (doc_dir / target).exists() or (root / target).exists()


def _repo_path_candidate(text: str, doc_dir: Path, root: Path) -> str | None:
    """A code span worth checking as a path: relative, plain, and rooted in an existing directory."""
    if not text or any(char.isspace() for char in text) or _NOT_A_PATH_CHARS & set(text) or "..." in text:
        return None
    if _SCHEME.match(text) or text[0] in "~/@-.:" and not text.startswith(("./", "../")):
        return None
    path = _LINE_SUFFIX.sub("", text).rstrip("/")
    if path.startswith(("./", "../")):
        return path
    if "/" not in path:
        return None
    first = path.split("/", 1)[0]
    return path if (root / first).exists() or (doc_dir / first).exists() else None


def check_doc(doc: Path, root: Path) -> tuple[int, list[str]]:
    doc_dir = doc.parent
    name = relative(doc, root)
    problems: list[str] = []
    checked = 0
    package_json = _nearest(doc_dir, root, "package.json")
    scripts = _package_scripts(package_json) if package_json else set()
    makefile = _nearest(doc_dir, root, "Makefile")
    targets = _make_targets(makefile) if makefile else set()

    def check_commands(line_no: int, text: str):
        nonlocal checked
        for script in _SCRIPT_RUN.findall(text):
            if "." in script and _exists(script, doc_dir, root):
                continue  # `bun run file.ts` runs a file, not a script
            checked += 1
            if script not in scripts:
                where = relative(package_json, root) if package_json else "no package.json"
                problems.append(f"{name}:{line_no}: unknown package script '{script}' ({where})")
        for target in _MAKE.findall(text):
            checked += 1
            if target not in targets:
                where = relative(makefile, root) if makefile else "no Makefile"
                problems.append(f"{name}:{line_no}: unknown make target '{target}' ({where})")

    in_fence = False
    for line_no, line in enumerate((read_text(doc) or "").splitlines(), start=1):
        if _FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            check_commands(line_no, line)
            continue
        for target in _LINK.findall(_CODE_SPAN.sub("", line)):
            if target.startswith(("#", "//")) or _SCHEME.match(target):
                continue
            path = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not path:
                continue
            checked += 1
            if not _exists(path, doc_dir, root):
                problems.append(f"{name}:{line_no}: missing link target '{target}'")
        for span in _CODE_SPAN.findall(line):
            check_commands(line_no, span)
            path = _repo_path_candidate(span.strip(), doc_dir, root)
            if path is None:
                continue
            checked += 1
            if not _exists(path, doc_dir, root):
                problems.append(f"{name}:{line_no}: missing path '{span.strip()}'")
    return checked, problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", nargs="?", default=".", help="project root (default: current directory)")
    root = Path(parser.parse_args().root).resolve()

    total_checked = 0
    all_problems: list[str] = []
    for doc in list_files(root):
        if doc.suffix.lower() in _DOC_SUFFIXES:
            checked, problems = check_doc(doc, root)
            total_checked += checked
            all_problems.extend(problems)

    for problem in all_problems:
        print(problem)
    print(f"{total_checked} references checked, {len(all_problems)} missing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
