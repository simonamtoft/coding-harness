# Normalize report evidence before composing HTML

Use this reference only when a report mixes command/test/probe units or exposes backlog tickets with scheduling. Do not use it merely because several metrics share one clear unit.

Normalize only the fields the report needs. Keep this as a compact scratch structure or put it directly in the simple report manifest; do not create a separate JSON file unless a script will consume it:

```json
{
  "outcome": {
    "title": "One evidence-backed conclusion",
    "summary": "What changed or was learned"
  },
  "verification": {
    "commands": [
      { "name": "task typecheck", "status": "passed", "unit": "command" }
    ],
    "testSuites": [
      { "name": "browser", "status": "passed", "unit": "test" }
    ],
    "probes": [
      { "name": "seed integrity", "run": 9, "violations": 0, "unit": "probe" }
    ]
  },
  "findings": [
    { "title": "Finding", "evidence": "Exact source, command, or capture", "ticket": "T-1" }
  ],
  "tickets": [
    {
      "id": "T-1",
      "title": "Short title",
      "lane": "Recipient readiness",
      "suggestedStage": "start-first",
      "dependsOn": []
    }
  ],
  "limitations": ["What was not exercised"]
}
```

Rules:

- Keep commands, test cases, and probes in separate collections. Never put counts with different units in one numerator or label.
- Record exact commands and source paths in the data even when the visual uses shorter labels.
- Retain exact counts only when they are needed for later analysis; delivery reports should state check status rather than test-case totals unless a count materially supports the conclusion.
- Separate `suggestedStage` and lane position from `dependsOn`. Suggested order is not a hard dependency.
- Preserve parallel work by assigning the same stage to tickets that should start together.
- Omit empty collections. Any scratch data is temporary reasoning input, not a repository artifact or report attachment.
