#!/usr/bin/env python3
"""Paired, worker-only Pi reading trial. Raw evidence stays under probes/results/."""
import argparse
import hashlib
import json
import os
import re
import select
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
RESULTS = ROOT / 'probes/results/reader-compare'
MODELS = [('openai-codex', 'gpt-6-luna'), ('anthropic', 'claude-haiku-5-5')]
LIMIT_SECONDS = 180
VERSION = 1
SCORE_VERSION = 2


def command(*args):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_sources(spec):
    for name, expected in spec['sources'].items():
        actual = sha((ROOT / name).read_bytes())
        if actual != expected:
            raise RuntimeError(f'source changed: {name}; expected {expected}, found {actual}')


def question(case):
    paths = ', '.join(str(ROOT / path) for path in case['paths'])
    items = '\n'.join(f"{q['id']}: {q['ask']}" for q in case['questions'])
    return (f'Task: Use only these source files: {paths}. Answer the following factual questions '
            f'with IDs A, B, C in the Answered facts section. For each ID, cite the exact source path '
            f'and observed line or narrow line range that supports that answer. Do not guess line numbers. '
            f'Use the required Unresolved facts and Coverage limits sections; report any truncation. '
            f'Do not make suitability judgments or propose changes.\n{items}')


def result_text(messages):
    return '\n'.join(part.get('text', '') for part in messages[-1].get('content', [])
                     if part.get('type') == 'text') if messages else ''


def fact_blocks(answer):
    # Only the Answered facts section can satisfy the fact key. Unresolved IDs are not answers.
    heading = lambda name: re.search(r'(?im)^\s*(?:#+\s*)?\*{0,2}' + name + r':?\*{0,2}\s*$', answer)
    start = heading('Answered facts')
    end = heading('Unresolved facts')
    if not start or not end or end.start() <= start.end():
        return {}
    answered = answer[start.end():end.start()]
    marker = re.compile(r'(?m)^\s*(?:[-*]\s*)?(?:\*\*)?([ABC])(?:\s+\([^\n)]{1,65}\))?(?:\*\*)?\s*[:.](?:\*\*)?\s*')
    hits = list(marker.finditer(answered))
    return {m.group(1): answered[m.end():hits[i+1].start()] if i+1 < len(hits) else answered[m.end():]
            for i, m in enumerate(hits)}


def cited_lines(block, path, allow_basename=False):
    # Bind each labelled range to the preceding source path, stopping at the next path.
    basename = Path(path).name
    source = re.compile(r'(?<![\w/])(?:/?[\w.~-]+/)*[\w.~-]+\.(?:md|ts)(?=[:\s`),;]|$)')
    references = list(source.finditer(block))
    found = set()
    for i, ref in enumerate(references):
        valid = {path, str(ROOT / path)}
        if allow_basename:
            valid.add(basename)
        if ref.group() not in valid:
            continue
        segment = block[ref.end():references[i+1].start() if i+1 < len(references) else len(block)]
        matches = list(re.finditer(r'(?i)\blines?\s*\*{0,2}(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?', segment))
        matches += list(re.finditer(r'^:(\d{1,4})(?:[-–](\d{1,4}))?', segment))
        for match in matches:
            first, last = int(match.group(1)), int(match.group(2) or match.group(1))
            if first <= last and last - first <= 40:
                found.update(range(first, last + 1))
    return found


def score(answer, case, calls):
    blocks = fact_blocks(answer)
    facts = {}
    for q in case['questions']:
        block = blocks.get(q['id'], '')
        terms = all(term.lower() in block.lower() for term in q['mustContain'])
        citations = all(set(e['lines']).issubset(cited_lines(
            block, e['path'],
            len(case['paths']) == 1
        )) for e in q['evidence'])
        facts[q['id']] = {'termsPresent': terms, 'citationCandidate': citations,
                          'requiresAudit': not (terms and citations)}
    brief = str(Path.home() / '.pi/agent/skills/bulk-read/BULK-READER.md')
    allowed = {str(ROOT / path) for path in case['paths']} | {brief}
    return {'facts': facts,
            'briefFirst': bool(calls and calls[0].get('name') == 'read' and
                               calls[0].get('arguments', {}).get('path', '').replace('~', str(Path.home())) == brief),
            'readOnly': all(call.get('name') in ('read', 'grep') for call in calls),
            'sourceOnly': all(call.get('arguments', {}).get('path', '').replace('~', str(Path.home())) in allowed
                              for call in calls),
            'hasSections': all(heading in answer for heading in ('Answered facts', 'Unresolved facts', 'Coverage limits'))}


def run_child(case, provider, model, prompt_file, output, spent, cap):
    args = ['pi', '--mode', 'json', '-p', '--no-session', '--no-extensions',
            '--extension', str(ROOT / 'pi/agent/extensions/sandbox/index.ts'),
            '--extension', str(ROOT / 'pi/agent/extensions/secret-result-guard/index.ts'),
            '--provider', provider, '--model', model, '--thinking', 'low',
            '--tools', 'read,grep', '--append-system-prompt', str(prompt_file), question(case)]
    started = time.monotonic()
    messages, calls = [], []
    cost, usage = 0., dict(input=0, output=0, cacheRead=0, cacheWrite=0)
    status = 'complete'
    with output.open('wb') as raw, output.with_suffix('.stderr').open('w') as err:
        proc = subprocess.Popen(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=err,
                                start_new_session=True)
        pending = b''
        try:
            while True:
                remaining = LIMIT_SECONDS - (time.monotonic() - started)
                if remaining <= 0:
                    status = 'timeout'
                    break
                readable, _, _ = select.select([proc.stdout], [], [], min(remaining, 1))
                if not readable:
                    continue
                chunk = os.read(proc.stdout.fileno(), 65536)
                if not chunk:
                    break
                raw.write(chunk)
                raw.flush()
                pending += chunk
                lines = pending.split(b'\n')
                pending = lines.pop()
                for line in lines:
                    try: event = json.loads(line)
                    except (json.JSONDecodeError, UnicodeDecodeError): continue
                    if event.get('type') != 'message_end' or event.get('message', {}).get('role') != 'assistant':
                        continue
                    message = event['message']
                    messages.append(message)
                    reported = message.get('usage')
                    if not reported or not isinstance(reported.get('cost', {}).get('total'), (int, float)):
                        status = 'missing-usage'
                        break
                    cost += reported['cost']['total']
                    for field in usage:
                        usage[field] += reported.get(field, 0) or 0
                    calls.extend(part for part in message.get('content', []) if part.get('type') == 'toolCall')
                    if spent + cost >= cap:
                        status = 'budget-stop'
                        break
                if status != 'complete':
                    break
            if status != 'complete':
                os.killpg(proc.pid, signal.SIGTERM)
            try: exit_code = proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                exit_code = proc.wait()
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            proc.stdout.close()
    final = messages[-1] if messages else {}
    if status == 'complete' and (exit_code != 0 or final.get('stopReason') != 'stop'):
        status = 'infrastructure'
    answer = result_text(messages) if status == 'complete' else ''
    return {'case': case['id'], 'model': provider + '/' + model, 'status': status,
            'scoreVersion': SCORE_VERSION,
            'seconds': round(time.monotonic() - started, 3), 'exitCode': exit_code,
            'usage': usage if messages else None, 'cost': cost if messages else None,
            'stopReason': final.get('stopReason'), 'assessment': score(answer, case, calls) if answer else None,
            'answer': answer}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trials', type=int, default=10)
    parser.add_argument('--cap', type=float, default=5.)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--rescore', action='store_true', help='recheck existing answers offline without model calls')
    parser.add_argument('--batch', help='existing batch id to rescore after a Pi upgrade (only with --rescore)')
    parser.add_argument('--retry-incomplete', action='store_true', help='preserve and retry one failed attempt per cell')
    opts = parser.parse_args()
    if not 1 <= opts.trials <= 10 or not 0 < opts.cap <= 5:
        parser.error('trials must be 1..10, cap must be within (0, 5] dollars')
    if opts.batch and (not opts.rescore or not re.fullmatch(r'[0-9a-f]{16}', opts.batch)):
        parser.error('--batch needs --rescore and a 16-digit hex id')
    spec_bytes = (HERE / 'cases.json').read_bytes()
    spec = json.loads(spec_bytes)
    check_sources(spec)
    agent = (ROOT / 'pi/agent/agents/bulk-reader.md').read_text().split('---', 2)[-1].strip()
    installed_brief = Path.home() / '.pi/agent/skills/bulk-read/BULK-READER.md'
    if not installed_brief.is_file() or installed_brief.read_bytes() != (ROOT / 'shared/skills/bulk-read/BULK-READER.md').read_bytes():
        raise RuntimeError('installed bulk-reader brief differs from the pinned canonical brief')
    pi_version = command('pi', '--version')
    runtime = b''.join((ROOT / path).read_bytes() for path in (
        'AGENTS.md', 'shared/AGENTS.md', 'pi/agent/extensions/sandbox/index.ts',
        'pi/agent/extensions/secret-result-guard/index.ts'))
    identity = sha(spec_bytes + agent.encode() + runtime + pi_version.encode() + str(VERSION).encode())[:16]
    target = RESULTS / (opts.batch or identity)
    print(f'batch={target.name} pi={pi_version} cases={len(spec["cases"])} trials={opts.trials} cap=${opts.cap:g}', flush=True)
    if opts.dry_run: return
    if opts.rescore:
        if not target.is_dir() or not list(target.glob('*.result.json')):
            raise RuntimeError(f'no results in batch {target.name}')
        by_id = {case['id']: case for case in spec['cases']}
        for f in target.glob('*.result.json'):
            result = json.loads(f.read_text())
            if result['status'] != 'complete': continue
            calls = []
            for line in f.with_name(f.name.replace('.result.json', '.jsonl')).read_text().splitlines():
                try: event = json.loads(line)
                except json.JSONDecodeError: continue
                if event.get('type') == 'message_end' and event.get('message', {}).get('role') == 'assistant':
                    calls.extend(part for part in event['message'].get('content', []) if part.get('type') == 'toolCall')
            result['assessment'] = score(result['answer'], by_id[result['case']], calls)
            result['scoreVersion'] = SCORE_VERSION
            f.write_text(json.dumps(result, indent=2) + '\n')
        print('existing local records rescored offline', flush=True)
        return
    for provider, model in MODELS:
        rows = command('pi', '--list-models', model).splitlines()[1:]
        if not any(row.split()[:2] == [provider, model] for row in rows):
            raise RuntimeError(f'model not in Pi catalog: {provider}/{model}')
        if command('pi', 'auth', 'check', '--provider', provider, '--no-refresh') != 'ready':
            raise RuntimeError(f'provider not ready: {provider}')
    target.mkdir(parents=True, exist_ok=True)
    prompt_file = target / 'bulk-reader-prompt.md'
    prompt_file.write_text(agent + '\n')
    spent = sum((json.loads(f.read_text()).get('cost') or 0) for f in target.glob('*.result.json'))
    for repeat in range(opts.trials):
        for case in spec['cases']:
            order = MODELS if repeat % 2 == 0 else MODELS[::-1]
            for provider, model in order:
                key = f'{case["id"]}-{repeat+1:02d}-{model}'
                result_file = target / (key + '.result.json')
                if result_file.exists():
                    previous = json.loads(result_file.read_text())
                    if previous['status'] == 'complete': continue
                    attempt = target / (key + '.attempt1.result.json')
                    if not opts.retry_incomplete or attempt.exists():
                        print(f'incomplete cell {key}; pass --retry-incomplete once after inspecting evidence', flush=True)
                        return
                    for src, dest in ((result_file, attempt),
                                      (target / (key + '.jsonl'), target / (key + '.attempt1.jsonl')),
                                      (target / (key + '.stderr'), target / (key + '.attempt1.stderr'))):
                        src.rename(dest)
                if spent >= opts.cap - .05:
                    print(f'budget reserve reached after ${spent:.4f}; stopping', flush=True)
                    return
                result = run_child(case, provider, model, prompt_file, target / (key + '.jsonl'), spent, opts.cap)
                result_file.write_text(json.dumps(result, indent=2) + '\n')
                spent += result['cost'] or 0
                facts = result['assessment']['facts'] if result['assessment'] else {}
                good = sum(v['termsPresent'] and v['citationCandidate'] for v in facts.values())
                print(f'{key} {result["status"]} {good}/{len(case["questions"])} candidates '
                      f'${(result["cost"] or 0):.5f} {result["seconds"]:.1f}s total=${spent:.4f}', flush=True)
                if result['status'] != 'complete':
                    print('stopped after incomplete run; inspect local evidence before resuming', flush=True)
                    return
    print(f'finished {len(spec["cases"])*opts.trials*2} runs; reported worker total ${spent:.4f}; data: {target}', flush=True)


if __name__ == '__main__':
    try: main()
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        sys.exit(1)
