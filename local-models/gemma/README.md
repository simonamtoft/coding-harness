# Gemma playground

Local Gemma 4 12B (Google's QAT q4_0 GGUF) served by stock llama.cpp for Pi,
including offline use. Not deployed by `link.sh`. Pi provider configuration stays
in the machine-local `~/.pi/agent/models.json`.

## Start

Requires `llama-server` on `PATH` (`brew install llama.cpp`). Start the
foreground server in a dedicated terminal:

```bash
bash local-models/gemma/start.sh
```

The first run downloads about 7 GB into llama.cpp's cache, so do it while online.
Stop with Ctrl-C. The server listens on `127.0.0.1:8080` without authentication;
do not expose or proxy this port. It does not conflict with the Bonsai
playground on port 18080.

Check that it is serving:

```bash
curl http://127.0.0.1:8080/v1/models
```

## Connect Pi

Use `models.json`, not the built-in `/llama` provider: subagent children run
with `--no-extensions`, which disables `builtin:llama.cpp`. Add to
`~/.pi/agent/models.json`. `contextWindow` must match the server's `-c 32768`;
Pi otherwise assumes 128000 and overruns the server (see LLM-01). The `compat`
flags mirror the Bonsai profile's verified llama.cpp settings:

```json
{
  "providers": {
    "local": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "api": "openai-completions",
      "apiKey": "none",
      "compat": {
        "supportsStore": false,
        "supportsDeveloperRole": false,
        "maxTokensField": "max_tokens"
      },
      "models": [{
        "id": "gemma-4-12b",
        "name": "Gemma 4 12B QAT q4_0 (local)",
        "input": ["text"],
        "contextWindow": 32768,
        "maxTokens": 4096,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
      }]
    }
  }
}
```

Gemma 4 reasons by default: llama.cpp returns the reasoning in
`reasoning_content`, and it counts against `maxTokens`. A 150-token limit
produced no answer on a long prompt, so keep `maxTokens` generous.

Paseo lists it as "Gemma (local)" through `paseo/config.json`. Expect the first
turn of each new session to take about a minute while about 12,000 prompt
tokens are processed; startup prewarming was measured and rejected (LLM-06).

Select `local/gemma-4-12b` with `/model`, or route one subagent to it in
`~/.pi/agent/subagents.json`:

```json
{ "models": { "bulk-reader": "local/gemma-4-12b" } }
```
