"""Tests for the panel server's pure parts: python3 -I mods/panel/server/test_panel.py"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import panel  # noqa: E402


def user(text, **kw):
    return {'type': 'user', 'message': {'role': 'user', 'content': text}, 'timestamp': '2026-10-15T10:00:00Z', **kw}


def agent(*blocks, model='claude-opus-5-5', tokens=1000):
    return {'type': 'assistant', 'timestamp': '2026-10-15T10:01:00Z', 'message': {'model': model, 'content': list(blocks), 'usage': {'input_tokens': 10, 'cache_read_input_tokens': tokens}}}


def tool(id_, name, **inp):
    return {'type': 'tool_use', 'id': id_, 'name': name, 'input': inp}


def result(id_):
    return {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': id_, 'content': 'ok'}]}}


class UserText(unittest.TestCase):
    def test_typed_text_without_injected_reminders(self):
        self.assertEqual(panel.user_text(user('fix it <system-reminder>noise</system-reminder>')), 'fix it')

    def test_tool_results_meta_and_sidechains_are_not_the_user(self):
        self.assertIsNone(panel.user_text(result('a')))
        self.assertIsNone(panel.user_text(user('x', isMeta=True)))
        self.assertIsNone(panel.user_text(user('x', isSidechain=True)))

    def test_harness_markers_and_compaction_summaries_are_not_the_user(self):
        self.assertEqual(panel.user_text(user('<artifact-content-authored-by-others/> fix it')), 'fix it')
        self.assertIsNone(panel.user_text(user('summary', isCompactSummary=True)))
        self.assertIsNone(panel.user_text(user('This session is being continued from a previous conversation that ran out of context.')))

    def test_a_slash_command_reads_as_typed(self):
        self.assertEqual(panel.user_text(user('<command-name>/wtf</command-name><command-args>why</command-args>')), '/wtf why')


class Facts(unittest.TestCase):
    def test_the_tool_without_a_result_is_running(self):
        f = panel.facts([user('go'), agent(tool('a', 'Bash', command='ls')), result('a'), agent(tool('b', 'Bash', description='run the tests'))])
        self.assertEqual(f['running'], 'Bash: run the tests')
        self.assertEqual(f['contextTokens'], 1010)
        self.assertEqual(f['model'], 'claude-opus-5-5')

    def test_a_custom_title_wins_over_the_generated_one(self):
        f = panel.facts([{'type': 'custom-title', 'customTitle': 'Mine'}, {'type': 'ai-title', 'aiTitle': 'Generated'}])
        self.assertEqual(f['title'], 'Mine')

    def test_incremental_reading_matches_a_full_read(self):
        import tempfile, os
        rows = [user('go'), agent(tool('a', 'Read', file_path='/x')), result('a'), agent({'type': 'text', 'text': 'done'})]
        with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False) as fh:
            fh.write(json.dumps(rows[0]) + '\n' + json.dumps(rows[1]) + '\n')
        p = Path(fh.name)
        panel.cached_facts(p)
        with p.open('a') as fh:
            fh.write(''.join(json.dumps(r) + '\n' for r in rows[2:]))
        self.assertEqual(panel.cached_facts(p), panel.facts(rows))
        os.unlink(p)


class Digest(unittest.TestCase):
    def test_keeps_the_opener_and_the_newest_rows_within_the_budget(self):
        rows = [user('the task')] + [agent({'type': 'text', 'text': f'step {i} ' + 'x' * 900}) for i in range(200)]
        d = panel.digest(rows)
        self.assertTrue(d.startswith('FIRST MESSAGE FROM THE USER: the task'))
        self.assertIn('step 199', d)
        self.assertNotIn('step 0 ', d)
        self.assertIn('older rows left out', d)
        self.assertLessEqual(len(d), panel.DIGEST_CHARS + 200)

    def test_a_running_tool_is_marked(self):
        self.assertIn('Bash: ls (RUNNING now)', panel.digest([user('go')], 'Bash: ls'))


class ParseAnswer(unittest.TestCase):
    def test_reads_the_structured_output_and_cleans_it(self):
        out = json.dumps({'structured_output': {'title': 't', 'state': 'nope', 'now': 'n', 'needs': None, 'options': [{'label': ''}, {'label': 'A', 'detail': 'd', 'recommended': True}], 'done': [], 'next': None}, 'usage': {'input_tokens': 5, 'output_tokens': 2}})
        card = panel.parse_answer(out)
        self.assertEqual(card['state'], 'idle')
        self.assertEqual([o['label'] for o in card['options']], ['A'])
        self.assertEqual(card['_usage']['input'], 5)

    def test_falls_back_to_json_in_the_text(self):
        card = panel.parse_answer(json.dumps({'result': 'here: {"title":"t","state":"done","now":"n","needs":null,"options":[],"done":["x"],"next":null}'}))
        self.assertEqual(card['state'], 'done')

    def test_an_error_answer_raises(self):
        with self.assertRaises(RuntimeError):
            panel.parse_answer(json.dumps({'is_error': True, 'result': 'Not logged in'}))


class Machine(unittest.TestCase):
    def test_groups_are_the_limited_cgroups_the_sessions_run_in(self):
        import tempfile
        root = Path(tempfile.mkdtemp())
        for rel, mx in [('agents.slice', '6000'), ('agents.slice/a.service', '3000'), ('user.slice', 'max'), ('user.slice/term.scope', 'max')]:
            (root / rel).mkdir(parents=True, exist_ok=True)
            (root / rel / 'memory.max').write_text(mx + '\n')
            (root / rel / 'memory.high').write_text('max\n')
        old_root, old_of = panel.CGROUP, panel.cgroup_of
        panel.CGROUP = root
        panel.cgroup_of = lambda pid: {1: 'agents.slice/a.service', 2: 'user.slice/term.scope'}[pid]
        try:
            self.assertEqual(panel.group_paths([1, 2]), ['agents.slice', 'agents.slice/a.service'])
        finally:
            panel.CGROUP, panel.cgroup_of = old_root, old_of

    def test_git_state_counts_changes(self):
        import tempfile
        d = tempfile.mkdtemp()
        import subprocess as sp
        sp.run(['git', 'init', '-q', '-b', 'main', d], check=True)
        Path(d, 'a').write_text('x')
        g = panel.git_state(d)
        self.assertEqual((g['branch'], g['changed'], g['ahead']), ('main', 1, 0))
        self.assertIsNone(panel.git_state(tempfile.mkdtemp()))

    def test_the_tmux_pane_is_found_through_the_parents(self):
        class P:
            def ancestors(self, pid):
                return [pid, 50, 10]
        old = panel.tmux_panes
        panel.tmux_panes = lambda: {10: ('/tmp/tmux-1/x', '%3')}
        try:
            self.assertEqual(panel.tmux_target(99, P()), ('/tmp/tmux-1/x', '%3'))
        finally:
            panel.tmux_panes = old


if __name__ == '__main__':
    unittest.main()
