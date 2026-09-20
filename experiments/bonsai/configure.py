"""Explicit, backed-up opt-in; never change Pi settings or existing providers."""
import json
import os
from pathlib import Path
import tempfile


def merge(path, provider):
    if path.is_symlink():
        raise ValueError("Refusing to replace a symlinked models.json")
    existed = path.exists()
    original = path.read_bytes() if existed else None
    data = json.loads(original) if existed else {}
    providers = data.setdefault("providers", {})
    if "bonsai-local" in providers:
        if providers["bonsai-local"] == provider:
            print("bonsai-local already matches; no changes")
            return
        raise ValueError("Refusing to overwrite existing bonsai-local provider")
    providers["bonsai-local"] = provider
    path.parent.mkdir(parents=True, exist_ok=True)
    if existed:
        fd, backup = tempfile.mkstemp(prefix="models.json.pi75-", suffix=".bak", dir=path.parent)
        with os.fdopen(fd, "wb") as stream:
            stream.write(original)
        print("Backup:", backup)
    fd, temporary = tempfile.mkstemp(prefix=".models-pi75-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream, indent=2)
            stream.write("\n")
        # Detect ordinary concurrent edits; this is not a cross-process lock.
        if path.exists() != existed or (existed and path.read_bytes() != original):
            raise RuntimeError("models.json changed during merge; refusing replacement")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Added bonsai-local; defaults and other providers unchanged")


if __name__ == "__main__":
    provider = json.loads(Path(__file__).with_name("provider.json").read_text())
    merge(Path.home() / ".pi" / "agent" / "models.json", provider)
