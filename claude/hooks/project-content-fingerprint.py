#!/usr/bin/env python3

import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional


def git_paths(project_dir: Path) -> list[bytes]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=project_dir,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return [path for path in result.stdout.split(b"\0") if path]


def file_fingerprint(project_dir: Path, relative_path: bytes) -> str:
    path = os.path.join(os.fsencode(project_dir), relative_path)
    digest = hashlib.sha256()
    file_stat = os.lstat(path)
    digest.update(str(stat.S_IFMT(file_stat.st_mode)).encode())
    digest.update(b":")
    digest.update(str(file_stat.st_mode & 0o111).encode())
    digest.update(b"\0")

    if stat.S_ISLNK(file_stat.st_mode):
        digest.update(os.fsencode(os.readlink(path)))
    elif stat.S_ISREG(file_stat.st_mode):
        with open(path, "rb") as file:
            while chunk := file.read(1024 * 1024):
                digest.update(chunk)
    elif stat.S_ISDIR(file_stat.st_mode):
        nested = project_snapshot(Path(os.fsdecode(path)))
        digest.update(nested["fingerprint"].encode() if nested is not None else b"directory")
    else:
        digest.update(b"special")

    return digest.hexdigest()


def project_snapshot(project_dir: Path) -> Optional[dict[str, Any]]:
    project_digest = hashlib.sha256()
    files: dict[str, str] = {}
    try:
        for relative_path in sorted(git_paths(project_dir)):
            decoded_path = os.fsdecode(relative_path)
            try:
                digest = file_fingerprint(project_dir, relative_path)
            except FileNotFoundError:
                digest = hashlib.sha256(b"missing").hexdigest()
            files[decoded_path] = digest
            project_digest.update(relative_path)
            project_digest.update(b"\0")
            project_digest.update(digest.encode())
            project_digest.update(b"\0")
    except (OSError, subprocess.CalledProcessError):
        return None
    return {"fingerprint": project_digest.hexdigest(), "files": files}


def classify_changes(before: Any, after: dict[str, Any]) -> str:
    if not isinstance(before, dict) or not isinstance(before.get("files"), dict):
        return "unknown"

    before_files = before["files"]
    after_files = after["files"]
    changed_paths = {
        path
        for path in before_files.keys() | after_files.keys()
        if before_files.get(path) != after_files.get(path)
    }
    if not changed_paths:
        return "unchanged"
    if all(path.lower().endswith(".md") for path in changed_paths):
        return "markdown-only"
    return "other"


def load_baseline(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return None


def main() -> int:
    if len(sys.argv) not in (2, 3):
        return 2

    snapshot = project_snapshot(Path(sys.argv[1]).resolve())
    if snapshot is None:
        return 1

    baseline = load_baseline(Path(sys.argv[2])) if len(sys.argv) == 3 else None
    snapshot["changeScope"] = classify_changes(baseline, snapshot)
    print(json.dumps(snapshot, ensure_ascii=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
