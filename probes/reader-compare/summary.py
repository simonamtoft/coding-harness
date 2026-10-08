#!/usr/bin/env python3
"""Summarize complete local worker-comparison records; no model calls."""
import json
import statistics
import sys
from pathlib import Path

RESULTS = Path(__file__).resolve().parents[1] / 'results/reader-compare'


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: python3 probes/reader-compare/summary.py <batch-id>')
    folder = RESULTS / sys.argv[1]
    if not folder.is_dir():
        raise SystemExit(f'no local batch: {folder}')
    records = [json.loads(f.read_text()) for f in folder.glob('*.result.json') if '.attempt' not in f.name]
    for model in ('openai-codex/gpt-6-luna', 'anthropic/claude-haiku-5-5'):
        group = [r for r in records if r['model'] == model and r['status'] == 'complete']
        if not group:
            continue
        print(f'\n{model} ({len(group)} complete cells)')
        for case in sorted({r['case'] for r in group}):
            rows = [r for r in group if r['case'] == case]
            facts = [f for r in rows for f in r['assessment']['facts'].values()]
            print(f'  {case}: citations {sum(f["citationCandidate"] for f in facts)}/{len(facts)}, '
                  f'fact-term candidates {sum(f["termsPresent"] for f in facts)}/{len(facts)}, '
                  f'median wall {statistics.median(r["seconds"] for r in rows):.1f}s, '
                  f'median reported cost ${statistics.median(r["cost"] for r in rows):.5f}')
        facts = [f for r in group for f in r['assessment']['facts'].values()]
        print(f'  total: citations {sum(f["citationCandidate"] for f in facts)}/{len(facts)}, '
              f'brief first {sum(r["assessment"]["briefFirst"] for r in group)}/{len(group)}, '
              f'source-only {sum(r["assessment"]["sourceOnly"] for r in group)}/{len(group)}, '
              f'cost ${sum(r["cost"] for r in group):.5f}, '
              f'median wall {statistics.median(r["seconds"] for r in group):.1f}s')
    attempts = list(folder.glob('*.attempt*.result.json'))
    print(f'\nIncomplete attempts preserved: {len(attempts)}')
    for f in attempts:
        row = json.loads(f.read_text())
        print(f'  {f.name}: {row["status"]}; reported cost {row["cost"]}')


if __name__ == '__main__':
    main()
