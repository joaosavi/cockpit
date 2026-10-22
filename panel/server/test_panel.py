"""Tests for the panel server's pure parts: python3 -I panel/server/test_panel.py"""

import calendar
import json
import os
import time
import sys
import tempfile
import unittest
import threading
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

    def test_an_answer_waits_for_the_session_to_take_it(self):
        d = Path(tempfile.mkdtemp())
        old = (panel.INBOX, panel.live_sessions)
        panel.INBOX, panel.live_sessions = d, lambda: [{'sessionId': 's1'}]
        try:
            self.assertIn('panel mod', panel.send_to_session('s1', 'yes'))
            (d / 's1.seen').write_text('{}')
            def take():
                while not (d / 's1.json').exists():
                    time.sleep(0.05)
                msg = json.loads((d / 's1.json').read_text())
                (d / 's1.seen').write_text(json.dumps({'done': msg['id']}))
            threading.Thread(target=take).start()
            self.assertIsNone(panel.send_to_session('s1', ' Round the total \n'))
            self.assertEqual(json.loads((d / 's1.json').read_text())['text'], 'Round the total')
            (d / 's1.json').unlink()
            self.assertEqual(panel.send_to_session('s1', 'again', wait_s=0.3), 'the session did not take the message')
            self.assertFalse((d / 's1.json').exists())
        finally:
            panel.INBOX, panel.live_sessions = old


class Tasks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.old = (panel.TASKS, panel.TODO_STATE, panel.TASK_LIST, panel.TASK_OWNER)
        panel.TASKS, panel.TODO_STATE, panel.TASK_LIST, panel.TASK_OWNER = root / 'tasks', root / 'todo', 'requests', 'me'
        self.write('requests', '1', '[a] P2 queued: clean the disk')
        self.write('requests', '2', '[me] P0 sign the contract')
        self.write('requests', '3', '[b] untagged work', status='in_progress')
        self.write('requests', '4', '[c] wrong subject', meta={'priority': 'P1', 'state': 'espera'})
        self.write('requests', '5', '[d] P1 fila: done already', status='completed')
        self.write('requests', '.lock', 'x')
        self.write('0f8fad5b-d9cb-469f-a165-70867728950e', '1', 'session work')
        (panel.TODO_STATE).mkdir(parents=True)
        lines = [{'at': '2026-10-22T10:00:00.000Z', 'event': 'archived', 'id': str(i), 'subject': f'[a] P1 fila: old {i}'} for i in range(40)]
        (panel.TODO_STATE / 'requests.jsonl').write_text('\n'.join(json.dumps(x) for x in lines) + '\nnot json\n')

    def tearDown(self):
        panel.TASKS, panel.TODO_STATE, panel.TASK_LIST, panel.TASK_OWNER = self.old
        self.tmp.cleanup()

    def write(self, lst, tid, subject, status='pending', meta=None):
        d = panel.TASKS / lst
        d.mkdir(parents=True, exist_ok=True)
        body = {'id': tid, 'subject': subject, 'status': status, 'description': 'why'}
        if meta:
            body['metadata'] = meta
        (d / f'{tid}.json').write_text(json.dumps(body) if tid != '.lock' else subject)

    def test_the_subject_gives_owner_priority_state_and_title(self):
        t = panel.parse_task({'id': '1', 'subject': '[x] P1 fila: role hierarchy', 'status': 'pending'})
        self.assertEqual((t['owner'], t['priority'], t['state'], t['stage'], t['title']), ('x', 'P1', 'fila', 'queued', 'role hierarchy'))
        t = panel.parse_task({'id': '1', 'subject': '[x] note: keep the colon', 'status': 'pending'})
        self.assertEqual((t['priority'], t['state'], t['title']), (None, None, 'note: keep the colon'))
        self.assertIsNone(panel.parse_task({'id': 1, 'subject': 'x', 'status': 'pending'}))
        self.assertIsNone(panel.parse_task({'id': '1', 'subject': 'x', 'status': 'deleted'}))

    def test_the_list_is_sorted_by_priority_and_staged(self):
        s = panel.tasks_snapshot(None)
        self.assertEqual(s['list'], 'requests')
        self.assertEqual([(t['id'], t['stage']) for t in s['tasks']], [('2', 'waiting'), ('4', 'waiting'), ('1', 'queued'), ('3', 'progress')])
        self.assertEqual(s['tasks'][1]['priority'], 'P1')

    def test_lists_put_the_named_one_first_and_unknown_names_fall_back(self):
        s = panel.tasks_snapshot('../../etc')
        self.assertEqual(s['list'], 'requests')
        self.assertEqual([l['id'] for l in s['lists']], ['requests', '0f8fad5b-d9cb-469f-a165-70867728950e'])
        self.assertTrue(s['lists'][1]['isSession'])
        self.assertEqual(panel.tasks_snapshot('0f8fad5b-d9cb-469f-a165-70867728950e')['tasks'][0]['title'], 'session work')

    def test_completed_tasks_come_newest_first_and_capped(self):
        done = panel.tasks_snapshot('requests')['done']
        self.assertEqual(len(done), panel.DONE_SHOWN)
        self.assertEqual(done[0]['id'], '39')
        self.assertEqual(done[0]['at'], calendar.timegm((2026, 10, 22, 10, 0, 0)))

    def test_no_task_folder_gives_an_empty_tab(self):
        panel.TASKS = Path(self.tmp.name) / 'missing'
        s = panel.tasks_snapshot(None)
        self.assertEqual({k: s[k] for k in ('lists', 'list', 'tasks', 'done')}, {'lists': [], 'list': None, 'tasks': [], 'done': []})


class Portable(unittest.TestCase):
    def test_processes_come_from_ps_without_proc(self):
        old = panel.HAS_PROC
        panel.HAS_PROC = False
        try:
            p = panel.Processes()
        finally:
            panel.HAS_PROC = old
        self.assertIn(os.getpid(), p.parent)
        self.assertGreater(p.rss[os.getpid()], 0)
        self.assertEqual(p.ancestors(os.getpid())[0], os.getpid())

    def test_the_overview_works_without_cgroups(self):
        old = panel.HAS_CGROUP2
        panel.HAS_CGROUP2 = False
        try:
            o = panel.overview([], panel.Processes(), time.time())
        finally:
            panel.HAS_CGROUP2 = old
        self.assertEqual(o['groups'], [])

    def test_cpu_counts_disk_wait_apart_from_busy(self):
        ticks = iter([(1000, 500, 100), (2000, 700, 600)])
        old = panel.cpu_times
        panel.cpu_times = lambda: next(ticks, (2000, 700, 600))
        try:
            c = panel.Cpu().read(time.time())
        finally:
            panel.cpu_times = old
        self.assertEqual((c['busy'], c['iowait']), (30, 50))

    def test_cpu_falls_back_to_ps_without_a_tick_counter(self):
        old = panel.cpu_times
        panel.cpu_times = lambda: None
        try:
            c = panel.Cpu().read(time.time())
        finally:
            panel.cpu_times = old
        self.assertIsNone(c['iowait'])
        self.assertGreaterEqual(c['busy'], 0)

    def test_a_mod_model_call_is_priced(self):
        e = {'inputTokens': 1_000_000, 'outputTokens': 100_000, 'cacheReadTokens': 0, 'cacheCreationTokens': 0}
        self.assertAlmostEqual(panel.tokens_cost(e, 'haiku'), 0.10 + 0.05)
        self.assertAlmostEqual(panel.tokens_cost(e, 'claude-sonnet-5-5'), 2.0 + 1.0)
        self.assertEqual(panel.tokens_cost(e, 'unknown-model'), 0.0)


if __name__ == '__main__':
    unittest.main()
