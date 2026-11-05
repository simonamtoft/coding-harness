"""List a project's files the way Git sees them, so ignored and vendored files stay out of scans."""

import os
import subprocess
from pathlib import Path

# Used only outside Git repositories, where .gitignore cannot be consulted.
_FALLBACK_SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next"}
_MAX_TEXT_BYTES = 2_000_000


def list_files(root: Path) -> list[Path]:
    """Tracked plus untracked-but-not-ignored files under root, sorted."""
    try:
        listing = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            capture_output=True,
            check=True,
        ).stdout.decode()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return sorted(_walk(root))
    return sorted(root / name for name in listing.split("\0") if name and (root / name).is_file())


def _walk(root: Path):
    for directory, subdirs, files in os.walk(root):
        subdirs[:] = [name for name in subdirs if name not in _FALLBACK_SKIP_DIRS]
        for name in files:
            yield Path(directory) / name


def read_text(path: Path) -> str | None:
    """File contents, or None for oversized or unreadable files."""
    try:
        if path.stat().st_size > _MAX_TEXT_BYTES:
            return None
        return path.read_text(errors="replace")
    except OSError:
        return None


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()
