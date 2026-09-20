# Bonsai playground

Local experiments with Ternary Bonsai 2 27B on an M4 Pro MacBook with 24 GB
unified memory, for use with Pi.

Setup scripts, the credential-free provider template, [trial results](RESULTS.md),
and [performance analysis](PERFORMANCE.md) are tracked. The analysis records the
profiling comparison, memory/I/O findings, MLX limitations, and untested options.
Model weights, downloaded runtimes, fixtures, sessions, and logs stay ignored under
`local/`. This is PI-75, not the broader PI-50 evaluation suite.

This playground is not deployed by `link.sh`. Pi provider configuration remains
in the machine-local `~/.pi/agent/models.json`; do not store credentials here.
Pi defaults and model-routing policy are unchanged.

## Reproduce setup

Requires Apple Silicon macOS, Python 3, curl, and Pi (tested with 0.85.1).
Allow approximately 8 GB of disk for the model and runtime, plus trial logs.
Run these commands from the checkout root. Downloads do not start a server or
change Pi configuration.

```bash
bash experiments/bonsai/setup.sh
```

The script checks SHA-256 before extracting or accepting downloads. It resumes
partial downloads and refuses checksum mismatches. Stock llama.cpp cannot run
these weights. Pins and checksums are recorded in `setup.sh`:

| Artifact | Pin | SHA-256 |
| --- | --- | --- |
| Prism macOS ARM64 archive | `prism-b10683-d8f26ee` | `0ae163ca2c9cce92470316ed743f76985beea4d5cf31b8dc546711cf6fc8dd35` |
| `Ternary-Bonsai-2-27B-PQ2_0.gguf` | HF revision `6ed5e12bf84b7a63069882c91dd9e9218647d17b` | `3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1` |

The runtime matches the official demo's pin at
[`c398c6ee`](https://github.com/PrismML-Eng/Bonsai-demo/blob/c398c6eeef7533dd9398682cc1297e33670df0cd/scripts/download_binaries.sh).
The latest release at inspection had no macOS archive. No MLX, vision projector,
drafter, Open WebUI, source build, or automatic startup is installed.

## Start and verify

Start the foreground server in a dedicated terminal:

```bash
bash experiments/bonsai/start.sh 2>&1 | tee experiments/bonsai/local/logs/server.log
```

Wait for `listening on http://127.0.0.1:18080`. Stop with Ctrl-C. The server uses
Metal, 24576-token context, one inference slot, the embedded Jinja tool template,
and a 512-token default reasoning budget. Pi and the probes request at most 2048
output tokens per completion. CORS is restricted to its own loopback origin; the
web UI and server-side agent tools are disabled. There is no authentication:
other processes on this machine can call it. Do not expose or proxy this port.

In another terminal, verify streaming and a complete tool-call/result/answer:

```bash
python3 experiments/bonsai/probe.py
```

The probe also checks that `reasoning_effort: none` disables reasoning. It saves
raw stream events and timings to `local/logs/probe-*.json`. The startup log records
GPU offload and the active 512-token budget. Model-card `low` reasoning is not
supported; this provider exposes only `off` and `medium`. The server enforces the
reasoning default; Pi's thinking setting does not configure a dynamic token cap.

## Opt Pi into the local provider

Do not edit `models.json` concurrently with this step:

```bash
python3 experiments/bonsai/configure.py
pi --provider bonsai-local --model bonsai-2-pq2 --thinking medium
```

`configure.py` backs up an existing `~/.pi/agent/models.json` to a private
`models.json.pi75-*.bak` beside it, merges `provider.json`, and preserves other
providers and fields. It refuses a conflicting `bonsai-local` entry or a symlinked
configuration file. An identical entry is a no-op. No `settings.json` is changed.
If upgrading an existing 16K experiment entry, back up `models.json` first, then
change only `providers.bonsai-local.models[0].contextWindow` to `24576` to match
`start.sh`; the merge helper deliberately refuses conflicting existing entries.
To undo, remove only `providers.bonsai-local` from the current configuration;
restore the whole backup only if no subsequent configuration edits need keeping.
Backups may contain credentials: leave them machine-local.

## Bounded trials

Use trusted disposable fixtures only: Pi can execute model-generated code.
Every current Pi trial retains the existing tool-call guard. This is not OS
isolation: generated programs and the runner's post-trial tests still run with
host permissions. Run one trial at a time while the server is idle. `trial.py` records the server PID for memory
sampling from `local/logs/server-pid.json`. For a manually started server, discover
its PID with `lsof -nP -iTCP:18080 -sTCP:LISTEN` and create that local file with
`{"pid": <server-pid>}` before running trials.

```bash
python3 experiments/bonsai/trial.py explain
python3 experiments/bonsai/trial.py repair
python3 experiments/bonsai/trial.py repair
python3 experiments/bonsai/trial.py repair
python3 experiments/bonsai/trial.py followup --fixture <absolute-repair-fixture-path>
python3 experiments/bonsai/trial.py explain --normal-harness
python3 experiments/bonsai/trial.py explain --normal-harness --thinking off
```

Each repair starts with the same seeded bug in a new directory. Use the printed
fixture path for follow-up, which reuses that repair's Pi session. The five-minute
cap covers the Pi process, not setup or post-trial verification. An initial
nonzero test exit during repair is expected. Independent post-trial tests must
pass; explanation intentionally leaves the seeded bug unchanged.

Baseline trials disable automatic extension discovery, skills, prompt templates,
and context-file discovery, but explicitly load `pi/agent/extensions/sandbox/index.ts`.
`--normal-harness` keeps normal discovery, including the guard and inherited
checkout instructions. Both select the local provider explicitly and prohibit
delegation in the prompt. `--thinking off` disables reasoning for a controlled
comparison; the default remains `medium`. Sampling settings are unchanged in this
comparison. The earlier unguarded baseline measurements are labelled in RESULTS.md.
The initial 16K profile is historical; the user approved 24K for subsequent tuning.
Keep the server context and Pi's `contextWindow` equal when changing profiles. The normal harness's subagents remain model-pinned to cloud
providers; they do not inherit Bonsai automatically. No remote worker output may
be credited as local trial work.

`local/logs/<trial>/` contains JSON events, errors, timing/resource summaries,
post-trial tests, and (with the current runner) final stop reason, guard profile,
file snapshots, server-log excerpts, and `vmmap` output. Check `answer_complete`:
a zero Pi exit code does not mean an answer avoided length truncation. RSS does not capture all Metal/mapped memory. Swap is system-wide
and reflects other applications too. A fresh server is not a cold filesystem
cache; record that distinction when repeating measurements.

## Upstream references

Inspected 2026-09-18:

- [Official Bonsai 2 collection](https://huggingface.co/collections/prism-ml/bonsai-2)
- [Bonsai 2 GGUF model card](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf)
- [Official setup and demo](https://github.com/PrismML-Eng/Bonsai-demo)
- [Prism llama.cpp fork](https://github.com/PrismML-Eng/llama.cpp)
