#!/usr/bin/env python3
"""Compare the environment variables a project declares with those its code reads.

Declarations come from env template files (such as .env.example) and from
NAME=value lines inside fenced Markdown blocks. Real .env files are never read.
Usage is found by literal-name patterns in non-test source files, so dynamic
names, destructuring and settings classes (for example pydantic BaseSettings)
are not detected.
"""

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

from repo_files import list_files, read_text, relative

_TEMPLATE_NAME = re.compile(r"^(\.env\.(example|sample|template|dist|defaults)|example\.env|env\.example)$")
_TEMPLATE_LINE = re.compile(r"^\s*#?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
_DOC_LINE = re.compile(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=")
_FENCE = re.compile(r"^\s*(```|~~~)")
_SOURCE_SUFFIXES = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte",
                    ".astro", ".py", ".go", ".rb"}
_NAME = r"([A-Za-z_][A-Za-z0-9_]*)"
_QUOTED = r"""['"]""" + _NAME + r"""['"]"""
_USAGE = tuple(re.compile(pattern) for pattern in (
    r"process\.env\." + _NAME,
    r"process\.env\[\s*" + _QUOTED + r"\s*\]",
    r"import\.meta\.env\." + _NAME,
    r"Bun\.env\." + _NAME,
    r"Deno\.env\.get\(\s*" + _QUOTED,
    r"environ\[\s*" + _QUOTED + r"\s*\]",
    r"environ\.get\(\s*" + _QUOTED,
    r"getenv\(\s*" + _QUOTED,
    r"os\.Getenv\(\s*" + _QUOTED,
    r"ENV(?:\.fetch\(\s*|\[\s*)" + _QUOTED,
))
# Tests set and read variables for their own harness; those are not project configuration.
_TEST_PATH = re.compile(r"(^|/)(tests?|__tests__)/|\.(test|spec)\.[^/]+$|(^|/)(test_[^/]+|[^/]+_test)\.py$|(^|/)conftest\.py$")
# Set by the runtime, shell or bundler rather than by the project's configuration.
_AMBIENT = {"NODE_ENV", "CI", "HOME", "PATH", "PWD", "USER", "SHELL", "TMPDIR", "TERM", "LANG",
            "MODE", "DEV", "PROD", "SSR", "BASE_URL"}


def _declarations(files: list[Path], root: Path) -> dict[str, list[str]]:
    declared: dict[str, list[str]] = defaultdict(list)
    for path in files:
        is_template = bool(_TEMPLATE_NAME.match(path.name))
        if not is_template and path.suffix.lower() not in {".md", ".mdx"}:
            continue
        in_fence = False
        for line_no, line in enumerate((read_text(path) or "").splitlines(), start=1):
            if _FENCE.match(line):
                in_fence = not in_fence
                continue
            pattern = _TEMPLATE_LINE if is_template else _DOC_LINE if in_fence else None
            match = pattern and pattern.match(line)
            if match:
                declared[match.group(1)].append(f"{relative(path, root)}:{line_no}")
    return declared


def _usages(files: list[Path], root: Path) -> dict[str, list[str]]:
    used: dict[str, list[str]] = defaultdict(list)
    for path in files:
        name_in_repo = relative(path, root)
        if path.suffix.lower() not in _SOURCE_SUFFIXES or _TEST_PATH.search(name_in_repo):
            continue
        for line_no, line in enumerate((read_text(path) or "").splitlines(), start=1):
            for name in {name for pattern in _USAGE for name in pattern.findall(line)}:
                used[name].append(f"{name_in_repo}:{line_no}")
    return used


def _print_section(title: str, entries: dict[str, list[str]], names) -> None:
    print(f"\n## {title}")
    names = sorted(names)
    if not names:
        print("(none)")
    for name in names:
        locations = entries[name]
        more = f", +{len(locations) - 3} more" if len(locations) > 3 else ""
        print(f"{name}  {', '.join(locations[:3])}{more}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", nargs="?", default=".", help="project root (default: current directory)")
    root = Path(parser.parse_args().root).resolve()

    files = list_files(root)
    declared = _declarations(files, root)
    used = _usages(files, root)
    templates = sorted({location.rsplit(":", 1)[0] for locations in declared.values() for location in locations})

    print(f"declared in: {', '.join(templates) if templates else '(no env template or documented NAME=value lines)'}")
    _print_section("Read in code but not declared", used, set(used) - set(declared) - _AMBIENT)
    _print_section("Declared but not read in code", declared, set(declared) - set(used))
    return 0


if __name__ == "__main__":
    sys.exit(main())
