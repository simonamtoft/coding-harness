import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('reader_trial', Path(__file__).with_name('run.py'))
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class ScoreTests(unittest.TestCase):
    def setUp(self):
        self.case = {'paths': ['src/worker.ts'], 'questions': [{'id': 'A', 'mustContain': ['message_end', 'tool_result_end'],
                                   'evidence': [{'path': 'src/worker.ts', 'lines': [38, 43]}]}]}
        self.read = [{'name': 'read', 'arguments': {'path': str(Path.home() / '.pi/agent/skills/bulk-read/BULK-READER.md')}}]

    def test_same_fact_needs_terms_and_narrow_citation(self):
        answer = ('**Answered facts**\nA: message_end and tool_result_end. '
                  'src/worker.ts lines 38–43.\n**Unresolved facts**\nNone.\n**Coverage limits**\nNone.')
        result = trial.score(answer, self.case, self.read)
        self.assertTrue(result['facts']['A']['termsPresent'])
        self.assertTrue(result['facts']['A']['citationCandidate'])
        self.assertTrue(result['briefFirst'])
        self.assertTrue(result['hasSections'])

    def test_wrong_range_and_unbound_answer_are_not_success(self):
        answer = ('A: message_end and tool_result_end. src/worker.ts lines 35–36.\n'
                  'B: src/worker.ts lines 38–43.')
        result = trial.score(answer, self.case, [{'name': 'grep', 'arguments': {}}])
        self.assertFalse(result['facts']['A']['citationCandidate'])
        self.assertFalse(result['briefFirst'])
        self.assertFalse(result['sourceOnly'])
        self.assertFalse(result['hasSections'])

    def test_unresolved_question_cannot_satisfy_answered_facts(self):
        answer = ('Answered facts\nA: Not answered.\nUnresolved facts\n'
                  'A: message_end and tool_result_end. src/worker.ts lines 38–43.\n'
                  'Coverage limits\nNone.')
        self.assertFalse(trial.score(answer, self.case, self.read)['facts']['A']['termsPresent'])

    def test_line_range_for_another_file_does_not_count(self):
        block = 'src/worker.ts is the requested file. other.ts lines 38–43.'
        self.assertEqual(trial.cited_lines(block, 'src/worker.ts'), set())

    def test_large_sweep_and_wrong_path_are_not_citations(self):
        self.assertEqual(trial.cited_lines('src/worker.ts lines 1–90', 'src/worker.ts'), set())
        self.assertEqual(trial.cited_lines('other.ts line 38', 'src/worker.ts'), set())
        self.assertEqual(trial.cited_lines('src/worker.ts:38-43', 'src/worker.ts'), set(range(38, 44)))

    def test_incidental_A_at_start_of_coverage_is_not_a_fact_id(self):
        answer = ('Answered facts\nA: message_end and tool_result_end. src/worker.ts lines 38–43.\n'
                  'Unresolved facts\nNone.\nCoverage limits\nA third event was not inspected.')
        self.assertIn('message_end', trial.fact_blocks(answer)['A'])

    def test_parenthetical_id_and_unique_basename_citation(self):
        case = dict(self.case, paths=['src/worker.ts'])
        answer = ('**Answered facts**\n- **A (events):** message_end and tool_result_end. '
                  'worker.ts:38 and worker.ts:43.\n**Unresolved facts**\nNone.\n'
                  '**Coverage limits** None.')
        result = trial.score(answer, case, self.read)
        self.assertTrue(result['facts']['A']['citationCandidate'])
        case['paths'] = ['src/worker.ts', 'elsewhere/other.ts']
        self.assertFalse(trial.score(answer, case, self.read)['facts']['A']['citationCandidate'])

    def test_child_json_usage_and_result_capture_without_real_pi(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            fake = directory / 'pi'
            events = [
                {'type': 'message_end', 'message': {'role': 'assistant', 'content': [
                    {'type': 'toolCall', 'name': 'read', 'arguments': {'path': str(Path.home() / '.pi/agent/skills/bulk-read/BULK-READER.md')}}],
                    'usage': {'input': 100, 'output': 20, 'cost': {'total': .001}}, 'stopReason': 'toolUse'}},
                {'type': 'message_end', 'message': {'role': 'assistant', 'content': [
                    {'type': 'text', 'text': 'Answered facts\\nA: message_end and tool_result_end. src/worker.ts lines 38–43.\\nUnresolved facts None.\\nCoverage limits None.'}],
                    'usage': {'input': 20, 'output': 30, 'cost': {'total': .002}}, 'stopReason': 'stop'}}]
            fake.write_text('#!' + os.environ.get('PYTHON', '/usr/bin/env') + ' python3\n'
                            'import json,sys\nfor event in ' + repr(events) + ': print(json.dumps(event), flush=True)\n')
            fake.chmod(0o755)
            case = dict(self.case, id='sample', questions=[dict(self.case['questions'][0], ask='Which events?')])
            with patch.dict(os.environ, PATH=str(directory) + os.pathsep + os.environ['PATH']):
                result = trial.run_child(case, 'test', 'model', fake, directory / 'run.jsonl', 0, 5)
            self.assertEqual(result['status'], 'complete')
            self.assertAlmostEqual(result['cost'], .003)
            self.assertEqual(result['usage']['input'], 120)
            self.assertTrue(result['assessment']['briefFirst'])
            self.assertEqual(len((directory / 'run.jsonl').read_text().splitlines()), 2)

    def test_case_prompt_names_only_requested_paths_and_ids(self):
        case = {'paths': ['src/worker.ts'], 'questions': [{'id': 'A', 'ask': 'Which events?'}]}
        prompt = trial.question(case)
        self.assertIn(str(trial.ROOT / 'src/worker.ts'), prompt)
        self.assertIn('A: Which events?', prompt)
        self.assertIn('Do not guess line numbers', prompt)


if __name__ == '__main__':
    unittest.main()
