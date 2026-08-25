#!/usr/bin/env python3

import hashlib
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Optional


def git_paths(project_dir: Path) -> list[bytes]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=project_dir,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return [path for path in result.stdout.split(b"\0") if path]


def update_file_hash(digest: "hashlib._Hash", project_dir: Path, relative_path: bytes) -> None:
    path = os.path.join(os.fsencode(project_dir), relative_path)
    file_stat = os.lstat(path)
    digest.update(relative_path)
    digest.update(b"\0")
    digest.update(str(stat.S_IFMT(file_stat.st_mode)).encode())
    digest.update(b":")
    digest.update(str(file_stat.st_mode & 0o111).encode())
    digest.update(b"\0")

    if stat.S_ISLNK(file_stat.st_mode):
        digest.update(os.fsencode(os.readlink(path)))
        return

    if stat.S_ISREG(file_stat.st_mode):
        with open(path, "rb") as file:
            while chunk := file.read(1024 * 1024):
                digest.update(chunk)
        return

    if stat.S_ISDIR(file_stat.st_mode):
        nested = project_fingerprint(Path(os.fsdecode(path)))
        digest.update(nested.encode() if nested is not None else b"directory")
        return

    digest.update(b"special")


def project_fingerprint(project_dir: Path) -> Optional[str]:
    digest = hashlib.sha256()
    try:
        for relative_path in sorted(git_paths(project_dir)):
            try:
                update_file_hash(digest, project_dir, relative_path)
            except FileNotFoundError:
                digest.update(relative_path)
                digest.update(b"\0missing\0")
    except (OSError, subprocess.CalledProcessError):
        return None
    return digest.hexdigest()


def main() -> int:
    if len(sys.argv) != 2:
        return 2

    fingerprint = project_fingerprint(Path(sys.argv[1]).resolve())
    if fingerprint is None:
        return 1

    print(fingerprint)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
