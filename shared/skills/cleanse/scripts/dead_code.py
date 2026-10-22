#!/usr/bin/env python3
"""Detect a project's stacks and run the dead-code analysers it already has installed.

Never installs or downloads a tool: analysers are taken from the project's
node_modules/.bin, .venv/bin or venv/bin, then from PATH. Missing analysers are
listed so the user can decide whether to install them.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

TIMEOUT_SECONDS = 600


@dataclass(frozen=True)
class Analyser:
    stack: str
    name: str
    finds: str
    args: tuple[str, ...]
    requires_file: str | None = None
    keep_lines: re.Pattern | None = None


ANALYSERS = (
    Analyser("javascript", "knip", "unused files, exports and dependencies",
             ("--no-progress", "--reporter", "compact", "--no-exit-code")),
    # tsc reports every type error; keep only the "declared but never used" family.
    Analyser("javascript", "tsc", "unused locals, parameters and imports",
             ("--noEmit", "--pretty", "false", "--noUnusedLocals", "--noUnusedParameters"),
             requires_file="tsconfig.json",
             keep_lines=re.compile(r"error TS6(133|138|192|196|198|199|205)\b")),
    Analyser("python", "ruff", "unused imports and variables",
             ("check", "--select", "F401,F811,F841", "--output-format", "concise", "--no-cache", "--exit-zero", ".")),
    Analyser("python", "vulture", "unused functions, classes and variables",
             (".", "--exclude", ".venv,venv,node_modules,build,dist")),
    Analyser("python", "deptry", "unused, missing and transitive dependencies", (".", "--no-ansi")),
)

_TOOL_DIRS = {"javascript": ("node_modules/.bin",), "python": (".venv/bin", "venv/bin")}
_PYTHON_MARKERS = ("pyproject.toml", "setup.py", "setup.cfg", "requirements.txt")


def detect_stacks(root: Path) -> list[str]:
    stacks = []
    if (root / "package.json").is_file():
        stacks.append("javascript")
    if any((root / marker).is_file() for marker in _PYTHON_MARKERS):
        stacks.append("python")
    return stacks


def find_tool(root: Path, analyser: Analyser) -> Path | None:
    for tool_dir in _TOOL_DIRS[analyser.stack]:
        candidate = root / tool_dir / analyser.name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    on_path = shutil.which(analyser.name)
    return Path(on_path) if on_path else None


def tsc_projects(root: Path, tool: Path) -> list[tuple[str, ...]]:
    """Extra arguments per TypeScript project to check.

    A solution-style tsconfig (empty `files` plus `references`, as in Vite templates)
    checks nothing by itself, so each referenced project is checked with `-p`.
    """
    try:
        shown = subprocess.run([str(tool), "--showConfig"], cwd=root, capture_output=True, text=True,
                               timeout=TIMEOUT_SECONDS)
        config = json.loads(shown.stdout)
    except (subprocess.TimeoutExpired, ValueError):
        return [()]
    references = [("-p", ref["path"]) for ref in config.get("references", [])
                  if isinstance(ref, dict) and isinstance(ref.get("path"), str)]
    own_files = bool(config.get("files") or config.get("include"))
    return ([()] if own_files or not references else []) + references


def run(root: Path, tool: Path, analyser: Analyser, extra_args: tuple[str, ...] = ()) -> str:
    try:
        result = subprocess.run([str(tool), *analyser.args, *extra_args], cwd=root, capture_output=True, text=True,
                                timeout=TIMEOUT_SECONDS, env={**os.environ, "NO_COLOR": "1"})
    except subprocess.TimeoutExpired:
        return f"(timed out after {TIMEOUT_SECONDS}s)"
    lines = (result.stdout + result.stderr).splitlines()
    if analyser.keep_lines:
        lines = [line for line in lines if analyser.keep_lines.search(line)]
    body = "\n".join(lines).strip() or "(no findings)"
    return f"exit {result.returncode}\n{body}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", nargs="?", default=".", help="project root (default: current directory)")
    root = Path(parser.parse_args().root).resolve()

    stacks = detect_stacks(root)
    if not stacks:
        print(f"No JavaScript/TypeScript or Python project detected at {root}.")
        return 0
    print(f"stacks: {', '.join(stacks)}")

    missing = []
    for analyser in ANALYSERS:
        if analyser.stack not in stacks:
            continue
        if analyser.requires_file and not (root / analyser.requires_file).is_file():
            continue
        tool = find_tool(root, analyser)
        if tool is None:
            missing.append(analyser)
            continue
        shown = tool.relative_to(root) if tool.is_relative_to(root) else tool
        print(f"\n## {analyser.name} ({analyser.finds}) — {shown}")
        for extra_args in tsc_projects(root, tool) if analyser.name == "tsc" else [()]:
            if extra_args:
                print(f"project: {extra_args[-1]}")
            print(run(root, tool, analyser, extra_args))

    if missing:
        print("\n## Not installed")
        for analyser in missing:
            print(f"- {analyser.name} ({analyser.stack}): {analyser.finds}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
