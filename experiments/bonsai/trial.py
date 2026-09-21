"""Run one bounded Pi trial with disposable fixtures and local JSON evidence."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / "local"
MODELS = {"pq2_0": "bonsai-2-pq2", "ptq1_0": "bonsai-2-ptq1"}
SOURCE = '''def chunks(items, size):
    """Split items into consecutive chunks; retain a short final chunk.

    size must be positive; empty input produces no chunks.
    """
    if size <= 0:
        raise ValueError("size must be positive")
    return [items[i:i + size] for i in range(0, len(items) - size + 1, size)]
'''
TESTS = '''import unittest
from chunks import chunks

class ChunkTests(unittest.TestCase):
    def test_remainder(self):
        self.assertEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
    def test_short(self):
        self.assertEqual(chunks([1], 3), [[1]])
    def test_empty(self):
        self.assertEqual(chunks([], 2), [])
    def test_exact(self):
        self.assertEqual(chunks([1, 2, 3, 4], 2), [[1, 2], [3, 4]])
    def test_invalid(self):
        with self.assertRaises(ValueError):
            chunks([1], 0)
'''
PROMPTS = {
    "explain": "Read chunks.py and test_chunks.py. Explain what chunks does and identify any mismatch with the tests. Do not edit files or delegate.",
    "repair": "Read chunks.py and test_chunks.py. Run python3 -m unittest -v to reproduce the bug, fix chunks.py using edit without changing the tests, rerun the tests, and use write to create NOTES.md with a short explanation. Do not delegate. Work only in this fixture directory.",
    "followup": "Extend chunks with a keyword-only strict=False option. When strict=True, reject a non-divisible input length with ValueError. Preserve default behavior. Add tests and run python3 -m unittest -v. Work only in this fixture directory; do not delegate.",
}


def swap_mb():
    value = subprocess.check_output(["sysctl", "vm.swapusage"], text=True)
    return float(re.search(r"used = ([\d.]+)M", value).group(1))


def run(kind, normal, fixture=None, thinking="medium", profile="pq2_0"):
    (LOCAL / "fixtures").mkdir(parents=True, exist_ok=True)
    if fixture is None:
        fixture = Path(tempfile.mkdtemp(prefix=kind + "-", dir=LOCAL / "fixtures"))
        (fixture / "chunks.py").write_text(SOURCE)
        (fixture / "test_chunks.py").write_text(TESTS)
    else:
        fixture = fixture.resolve()
        if fixture.parent != LOCAL / "fixtures":
            raise ValueError("Follow-up requires a fixture under local/fixtures")
    logdir = Path(tempfile.mkdtemp(prefix=f"{profile}-{kind}-", dir=LOCAL / "logs"))
    provider = json.loads((ROOT / "provider.json").read_text())
    model_id = MODELS[profile]
    model = next(item for item in provider["models"] if item["id"] == model_id)
    with urllib.request.urlopen("http://127.0.0.1:18080/props", timeout=10) as response:
        server = json.load(response)
    with urllib.request.urlopen("http://127.0.0.1:18080/v1/models", timeout=10) as response:
        active_ids = {item["id"] for item in json.load(response)["data"]}
    context_window = server["default_generation_settings"]["n_ctx"]
    if context_window != model["contextWindow"] or server["total_slots"] != 1:
        raise ValueError("Server does not match the tracked context/slot profile")
    if active_ids != {model_id}:
        raise ValueError(f"Expected {model_id}, server exposes {active_ids}")
    (logdir / "provider-template.json").write_text(json.dumps(provider, indent=2))
    command = ["pi", "--offline", "--provider", "bonsai-local", "--model", model_id,
               "--thinking", thinking, "--mode", "json", "--session", str(fixture / "session.jsonl"),
               "--print"]
    if not normal:
        command += ["--no-extensions", "--extension",
                    str(ROOT.parents[1] / "pi/agent/extensions/sandbox/index.ts"),
                    "--no-skills", "--no-prompt-templates", "--no-context-files"]
    command += [PROMPTS[kind]]
    server_record = json.loads((LOCAL / "logs/server-pid.json").read_text())
    server_pid = server_record["pid"]
    if "log" in server_record:
        server_log = Path(server_record["log"])
        if not server_log.is_absolute():
            server_log = ROOT.parents[1] / server_log
    else:
        profile_log = LOCAL / "logs" / f"server-{profile}.log"
        server_log = profile_log if profile_log.exists() else LOCAL / "logs/server.log"
    server_log_offset = server_log.stat().st_size
    first_output = None
    final_stop_reason = None
    start = time.monotonic()
    swap_start = swap_mb()
    peak_swap, peak_rss_kib = swap_start, 0
    with (logdir / "stderr.log").open("w") as err, (logdir / "events.jsonl").open("w") as out:
        process = subprocess.Popen(command, cwd=fixture, stdout=subprocess.PIPE, stderr=err,
                                   text=True, start_new_session=True)

        def collect():
            nonlocal first_output, final_stop_reason
            for line in process.stdout:
                out.write(line)
                out.flush()
                try:
                    event = json.loads(line)
                    if event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant":
                        final_stop_reason = event["message"].get("stopReason")
                    delta = event.get("assistantMessageEvent", {})
                    if first_output is None and delta.get("type") in ("text_delta", "thinking_delta", "toolcall_delta"):
                        first_output = time.monotonic() - start
                except json.JSONDecodeError:
                    pass

        reader = threading.Thread(target=collect, daemon=True)
        reader.start()
        timed_out = False
        while process.poll() is None:
            if time.monotonic() - start >= 300:
                timed_out = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                break
            rss = subprocess.run(["ps", "-p", str(server_pid), "-o", "rss="], text=True, capture_output=True)
            if rss.stdout.strip():
                peak_rss_kib = max(peak_rss_kib, int(rss.stdout.strip()))
            peak_swap = max(peak_swap, swap_mb())
            time.sleep(1)
        process.wait()
        reader.join(timeout=5)
    elapsed = time.monotonic() - start
    tests = subprocess.run(["python3", "-m", "unittest", "-v"], cwd=fixture,
                           text=True, capture_output=True, timeout=30)
    (logdir / "tests.log").write_text(tests.stdout + tests.stderr)
    for name in ("chunks.py", "test_chunks.py", "NOTES.md"):
        if (fixture / name).exists():
            (logdir / name).write_bytes((fixture / name).read_bytes())
    with server_log.open("rb") as stream:
        stream.seek(server_log_offset)
        (logdir / "server.log").write_bytes(stream.read())
    memory = subprocess.run(["vmmap", "-summary", str(server_pid)], text=True,
                            capture_output=True, timeout=20)
    (logdir / "memory.txt").write_text(memory.stdout + memory.stderr)
    summary = dict(kind=kind, profile=profile, model=model_id,
                   normal_harness=normal, thinking=thinking, server_context_window=context_window,
                   guard_profile="normal-discovery" if normal else "explicit-sandbox",
                   final_stop_reason=final_stop_reason,
                   answer_complete=final_stop_reason == "stop" and not timed_out,
                   fixture=str(fixture), command=command,
                   total_seconds=elapsed, first_output_seconds=first_output,
                   timed_out=timed_out, exit_code=process.returncode, tests_exit_code=tests.returncode,
                   peak_server_rss_kib=peak_rss_kib, swap_start_mb=swap_start,
                   peak_swap_mb=peak_swap, swap_end_mb=swap_mb())
    (logdir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(dict(logdir=str(logdir), **summary), indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=PROMPTS)
    parser.add_argument("--normal-harness", action="store_true")
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--thinking", choices=("off", "medium"), default="medium")
    parser.add_argument("--profile", choices=MODELS, default="pq2_0")
    args = parser.parse_args()
    if (args.kind == "followup") != (args.fixture is not None):
        parser.error("Only followup requires --fixture pointing to a completed repair fixture")
    run(args.kind, args.normal_harness, args.fixture, args.thinking, args.profile)
