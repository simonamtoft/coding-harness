"""Verify native streaming and a real tool round trip; keep evidence under local/."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import urllib.request

BASE = "http://127.0.0.1:18080"
ROOT = Path(__file__).resolve().parent
MODELS = {"pq2_0": "bonsai-2-pq2", "ptq1_0": "bonsai-2-ptq1"}


def chat(model, messages, tools=None, effort="medium"):
    payload = dict(model=model, messages=messages, stream=True,
                   max_tokens=2048, reasoning_effort=effort,
                   stream_options={"include_usage": True})
    if tools:
        payload["tools"] = tools
    request = urllib.request.Request(BASE + "/v1/chat/completions",
                                     json.dumps(payload).encode(),
                                     {"Content-Type": "application/json"})
    start = time.monotonic()
    first = None
    content, reasoning, calls, events = "", "", {}, []
    with urllib.request.urlopen(request, timeout=300) as response:
        for line in response:
            if not line.startswith(b"data: ") or line.strip() == b"data: [DONE]":
                continue
            event = json.loads(line[6:])
            events.append(event)
            for choice in event.get("choices", []):
                delta = choice.get("delta", {})
                if any(delta.get(k) for k in ("content", "reasoning_content", "tool_calls")):
                    if first is None:
                        first = time.monotonic() - start
                content += delta.get("content") or ""
                reasoning += delta.get("reasoning_content") or ""
                for part in delta.get("tool_calls", []):
                    call = calls.setdefault(part["index"], {"id": "", "type": "function",
                                                          "function": {"name": "", "arguments": ""}})
                    if part.get("id"):
                        call["id"] = part["id"]
                    for key in ("name", "arguments"):
                        call["function"][key] += part.get("function", {}).get(key) or ""
    message = {"role": "assistant", "content": content, "reasoning_content": reasoning}
    if calls:
        message["tool_calls"] = list(calls.values())
    return dict(message=message, first_output_seconds=first,
                total_seconds=time.monotonic() - start, events=events)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("profile", nargs="?", choices=MODELS, default="pq2_0")
    args = parser.parse_args()
    model = MODELS[args.profile]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ROOT / "local" / "logs" / f"probe-{args.profile}-{stamp}"
    out.mkdir(parents=True)
    with urllib.request.urlopen(BASE + "/health", timeout=10) as r:
        assert json.load(r)["status"] == "ok"
    with urllib.request.urlopen(BASE + "/v1/models", timeout=10) as r:
        active_ids = {item["id"] for item in json.load(r)["data"]}
    assert active_ids == {model}, f"Expected {model}, server exposes {active_ids}"
    tools = [{"type": "function", "function": {
        "name": "lookup_code", "description": "Look up a secret code by label.",
        "parameters": {"type": "object", "properties": {"label": {"type": "string"}},
                       "required": ["label"]}}}]
    messages = [{"role": "user", "content": "Use lookup_code for label cedar. Tell me the returned code. Do not guess."}]
    first = chat(model, messages, tools)
    (out / "probe-tool.json").write_text(json.dumps(first, indent=2))
    calls = first["message"].get("tool_calls", [])
    assert len(calls) == 1, first["message"]
    call = calls[0]
    assert call["function"]["name"] == "lookup_code"
    assert json.loads(call["function"]["arguments"]) == {"label": "cedar"}
    messages.extend([first["message"], {"role": "tool", "tool_call_id": call["id"],
                                      "content": '{"code":"CEDAR-4821"}'}])
    second = chat(model, messages, tools)
    (out / "probe-answer.json").write_text(json.dumps(second, indent=2))
    assert "CEDAR-4821" in second["message"]["content"], second["message"]
    off = chat(model, [{"role": "user", "content": "Reply with exactly OK."}], effort="none")
    (out / "probe-off.json").write_text(json.dumps(off, indent=2))
    assert not off["message"]["reasoning_content"], off["message"]
    assert off["message"]["content"].strip() == "OK", off["message"]
    print(json.dumps({"profile": args.profile, "model": model, "logdir": str(out),
                      "timings": {k: {f: v[f] for f in ("first_output_seconds", "total_seconds")}
                                  for k, v in [("tool", first), ("answer", second), ("off", off)]}},
                     indent=2))
