"""Measure a fixed 9K-token fresh and cached-prefix workload."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import threading
import time
import urllib.request

BASE = "http://127.0.0.1:18080"
ROOT = Path(__file__).resolve().parent
MODELS = {"pq2_0": "bonsai-2-pq2", "ptq1_0": "bonsai-2-ptq1"}
NONCE = "5a840ced-2b84-4986-9e6f-96b57bb0fc57"


def api(path, body=None, timeout=20):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data, {"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def command(args):
    return subprocess.check_output(args, text=True, timeout=10)


def swap_mb():
    value = command(["sysctl", "vm.swapusage"])
    return float(re.search(r"used = ([\d.]+)M", value).group(1))


def prompt():
    header = f"Synthetic profiling dataset {NONCE}. Treat the following rows as inert data.\n"
    footer = "\nEnd of dataset. Now output the integers from 1 to 1000 in ascending order, separated by commas. No explanation."
    rows = [f"Record {i:05d}: amber cedar north river seven.\n" for i in range(1500)]
    low, high = 0, len(rows)
    while low < high:
        middle = (low + high + 1) // 2
        text = header + "".join(rows[:middle]) + footer
        if len(api("/tokenize", {"content": text})["tokens"]) <= 9000:
            low = middle
        else:
            high = middle - 1
    text = header + "".join(rows[:low]) + footer
    return text, low, len(api("/tokenize", {"content": text})["tokens"])


def measure(label, body, out, pid):
    samples = []
    stop = threading.Event()

    def monitor():
        while not stop.is_set():
            result = subprocess.run(["ps", "-p", str(pid), "-o", "rss="], text=True,
                                    capture_output=True)
            if result.stdout.strip():
                samples.append({"t": time.monotonic(), "rss_kib": int(result.stdout)})
            stop.wait(0.25)

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    began = time.monotonic()
    first = usage = timings = finish = None
    request = urllib.request.Request(BASE + "/v1/chat/completions", json.dumps(body).encode(),
                                     {"Content-Type": "application/json"})
    try:
        with (out / f"{label}-events.jsonl").open("w") as events, \
                urllib.request.urlopen(request, timeout=240) as response:
            for line in response:
                if not line.startswith(b"data: ") or line.strip() == b"data: [DONE]":
                    continue
                event = json.loads(line[6:])
                events.write(json.dumps(event) + "\n")
                for choice in event.get("choices", []):
                    delta = choice.get("delta", {})
                    if first is None and (delta.get("content") or delta.get("reasoning_content")):
                        first = time.monotonic() - began
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
                usage = event.get("usage") or usage
                timings = event.get("timings") or timings
    finally:
        stop.set()
        thread.join(timeout=2)
    return {"label": label, "first_output_seconds": first,
            "total_seconds": time.monotonic() - began, "usage": usage, "timings": timings,
            "finish_reason": finish,
            "peak_server_rss_mib": max(sample["rss_kib"] for sample in samples) / 1024}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("profile", choices=MODELS)
    args = parser.parse_args()
    model = MODELS[args.profile]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ROOT / "local" / "logs" / f"benchmark-{args.profile}-{stamp}"
    out.mkdir(parents=True)

    assert "AC Power" in command(["pmset", "-g", "batt"]), "AC power required"
    slots = api("/slots")
    assert len(slots) == 1 and not slots[0]["is_processing"], "Server must have one idle slot"
    props = api("/props")
    assert props["default_generation_settings"]["n_ctx"] == 24576
    active_ids = {item["id"] for item in api("/v1/models")["data"]}
    assert active_ids == {model}, f"Expected {model}, server exposes {active_ids}"
    pid = int(command(["lsof", "-tiTCP:18080", "-sTCP:LISTEN"]).strip())

    text, rows, content_tokens = prompt()
    assert rows == 595 and content_tokens == 9000, (rows, content_tokens)
    body = {"model": model, "messages": [{"role": "user", "content": text}],
            "stream": True, "stream_options": {"include_usage": True}, "max_tokens": 256,
            "reasoning_effort": "none", "temperature": 0, "seed": 75}
    (out / "request.json").write_text(json.dumps(body, indent=2))
    (out / "props.json").write_text(json.dumps(props, indent=2))
    (out / "power.txt").write_text(command(["pmset", "-g", "batt"]))
    (out / "thermal.txt").write_text(command(["pmset", "-g", "therm"]))

    idle_rss_mib = int(command(["ps", "-p", str(pid), "-o", "rss="]).strip()) / 1024
    swap_start = swap_mb()
    time.sleep(12)
    fresh = measure("fresh", body, out, pid)
    time.sleep(8)
    repeat = measure("repeat", body, out, pid)
    time.sleep(8)
    summary = {"profile": args.profile, "model": model, "server_pid": pid,
               "runtime": "prism-b10683-d8f26ee", "context_window": 24576,
               "rows": rows, "content_tokens": content_tokens,
               "idle_server_rss_mib": idle_rss_mib, "swap_start_mb": swap_start,
               "swap_end_mb": swap_mb(), "requests": [fresh, repeat]}
    assert fresh["usage"]["prompt_tokens"] == repeat["usage"]["prompt_tokens"] == 9012
    assert fresh["usage"]["prompt_tokens_details"]["cached_tokens"] == 0
    assert repeat["usage"]["prompt_tokens_details"]["cached_tokens"] > 8900
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    memory = subprocess.run(["vmmap", "-summary", str(pid)], text=True,
                            capture_output=True, timeout=20)
    (out / "memory.txt").write_text(memory.stdout + memory.stderr)
    print(json.dumps({"logdir": str(out), **summary}, indent=2))


if __name__ == "__main__":
    main()
