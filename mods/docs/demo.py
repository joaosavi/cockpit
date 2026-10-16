"""Serves the panel with made-up sessions, for the screenshots in the docs. Nothing here reads the
machine's real sessions, transcripts or diaries, and no summary calls a model.

Run: python3 -I demo.py [port]   (default 7790), then open http://127.0.0.1:<port>/"""
import json, os, subprocess, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7790
ROOT = Path(tempfile.mkdtemp(prefix='cockpit-demo-'))
CONFIG, STATE = ROOT / 'claude', ROOT / 'state' / 'mods'
NOW = time.time()


def iso(t):
    return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(t))


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


SESSIONS = [
    dict(name='api', cwd='/home/dev/acme-api', branch='feat/billing', status='idle', up=6.5, ctx=412000, mem=702,
         prompt='the invoice totals are off by a cent on refunds, can you find out why?',
         git={'branch': 'feat/billing', 'changed': 3, 'ahead': 2, 'behind': 0},
         card=dict(title='Rounding in refunded invoices', state='waiting',
                   now='Found it: refunds round each line before summing, so a 3-line refund can lose a cent. The fix is ready in a branch.',
                   needs='Choose how refunds should round before the fix goes in.',
                   options=[{'label': 'Round the total, not each line', 'detail': 'Matches the original invoice. Changes 41 past refunds by a cent.', 'recommended': True},
                            {'label': 'Keep line rounding, fix the display', 'detail': 'No past refund changes, but totals still differ from the invoice.', 'recommended': False}],
                   done=['Reproduced the off-by-one-cent on a 3-line refund', 'Wrote a failing test for it', 'Traced it to round() per line in refunds.ts'],
                   next='Apply the rounding you choose and run the billing tests.')),
    dict(name='web', cwd='/home/dev/acme-web', branch='main', status='busy', up=3.2, ctx=188000, mem=540,
         prompt='move the settings page to the new layout',
         running='Bash: Run the end-to-end tests for the settings page',
         git={'branch': 'main', 'changed': 7, 'ahead': 0, 'behind': 1},
         card=dict(title='Settings page on the new layout', state='working',
                   now='Rebuilt the settings page on the new layout and is running the end-to-end tests.',
                   needs=None, options=[], done=['Moved the profile and billing sections', 'Replaced the old tabs with the side menu'],
                   next='Fix whatever the end-to-end tests catch, then open the pull request.')),
    dict(name='infra', cwd='/home/dev/infra', branch='main', status='idle', up=26, ctx=96000, mem=310,
         prompt='the staging deploy keeps failing since this morning',
         git={'branch': 'main', 'changed': 0, 'ahead': 0, 'behind': 0},
         card=dict(title='Staging deploy failing', state='blocked',
                   now='The deploy fails at the database migration: the staging user lost its permission on the schema.',
                   needs='Grant the deploy user CREATE on the staging schema, or give the agent admin access to do it.',
                   options=[], done=['Read the last six failed deploy logs', 'Confirmed the migration runs locally'], next=None)),
    dict(name='docs', cwd='/home/dev/acme-docs', branch='main', status='idle', up=1.1, ctx=54000, mem=260,
         prompt='update the API reference for the v3 endpoints',
         git={'branch': 'main', 'changed': 0, 'ahead': 0, 'behind': 0},
         card=dict(title='API reference for v3', state='done',
                   now='The reference covers the 14 v3 endpoints, with examples, and the pull request is open.',
                   needs=None, options=[], done=['Documented 14 endpoints', 'Added request and response examples', 'Opened the pull request'], next=None)),
]

# Processes that stand in for the sessions, so the page sees them as running.
procs = [subprocess.Popen(['sleep', '3600']) for _ in SESSIONS]
for i, (s, p) in enumerate(zip(SESSIONS, procs)):
    sid = f'0000000{i}-demo-4000-8000-00000000000{i}'
    s['sid'], s['pid'] = sid, p.pid
    write(CONFIG / 'sessions' / f'{p.pid}.json', json.dumps({
        'pid': str(p.pid), 'sessionId': sid, 'cwd': s['cwd'], 'kind': 'interactive', 'name': s['name'], 'version': '2.1.300',
        'status': s['status'], 'statusUpdatedAt': str(int((NOW - 60) * 1000)), 'startedAt': str(int((NOW - s['up'] * 3600) * 1000)),
        'bridgeSessionId': f'session_demo{i}'}))
    rows = [{'type': 'user', 'timestamp': iso(NOW - s['up'] * 3600), 'gitBranch': s['branch'], 'message': {'role': 'user', 'content': s['prompt']}}]
    for h in range(23, -1, -1):
        if (h + i) % 5 == 0 and h > 6 and i != 1:
            continue
        rows.append({'type': 'assistant', 'timestamp': iso(NOW - h * 3600 - 300), 'gitBranch': s['branch'], 'message': {
            'model': 'claude-opus-5-5', 'content': [{'type': 'text', 'text': 'Working on it.'}],
            'usage': {'input_tokens': 2000 + 900 * ((h * 7 + i) % 9), 'cache_creation_input_tokens': 1500 * ((h + 3 * i) % 6), 'cache_read_input_tokens': s['ctx'], 'output_tokens': 300 + 120 * ((h + i) % 7)}}})
    rows.append({'type': 'user', 'timestamp': iso(NOW - 400), 'gitBranch': s['branch'], 'message': {'role': 'user', 'content': s['prompt']}})
    rows.append({'type': 'assistant', 'timestamp': iso(NOW - 90 - 200 * i), 'gitBranch': s['branch'], 'message': {
        'model': 'claude-opus-5-5', 'usage': {'input_tokens': 50, 'cache_read_input_tokens': s['ctx']},
        'content': [{'type': 'tool_use', 'id': 'run1', 'name': 'Bash', 'input': {'description': s['running'].split(': ', 1)[1]}}] if s.get('running') else [{'type': 'text', 'text': 'Done.'}]}})
    write(CONFIG / 'projects' / s['name'] / f'{sid}.jsonl', ''.join(json.dumps(r) + '\n' for r in rows))
    write(STATE / 'panel' / 'summaries' / f'{sid}.json', json.dumps({**s['card'], 'at': NOW - 120 - 90 * i, 'sourceMtime': NOW + 86400, 'cwd': s['cwd']}))

write(CONFIG / 'settings.json', json.dumps({'autoCompactWindow': 733000, 'enabledPlugins': {}}))
write(CONFIG / 'plugins' / 'store' / 'usage-limit_cockpit-demo.json', json.dumps({'windows': {'at': NOW * 1000, 'windows': [
    {'kind': 'five_hour', 'percentUsed': 62, 'resetsAt': iso(NOW + 5000)}, {'kind': 'seven_day', 'percentUsed': 38, 'resetsAt': iso(NOW + 3 * 86400)}]}}))
MODS = {'secret-guard': ['redacted', 'redacted', 'filled'], 'collision-guard': ['git-held', 'edit-warned'], 'pipefail': ['rewritten'] * 4,
        'memory-guard': [], 'loop-breaker': ['nudge'], 'usage-limit': [],
        'skill-loader': ['loaded'] * 5, 'hud': [], 'spinner-status': [], 'global-memory': ['context-injected'] * 4, 'panel': []}
DETAIL = {'redacted': {'tool': 'Bash', 'names': 'STRIPE_KEY'}, 'filled': {'names': 'DATABASE_URL'}, 'git-held': {'op': 'stage-all', 'files': 2},
          'edit-warned': {'sessions': 'web'}, 'rewritten': {'key': 'npm test'}, 'reduced': {'key': 'tsc --noEmit'}, 'waited-and-fit': {'key': 'next build'},
          'refused': {'key': 'playwright test'}, 'nudge': {'kind': 'error', 'count': 3}, 'loaded': {'skill': 'typescript-best-practices'}}
installed = {}
for k, (mod, events) in enumerate(MODS.items()):
    lines = []
    for j, ev in enumerate(events):
        lines.append({'at': iso(NOW - 600 - 1700 * (j + k)), 'session': f'0000000{(j + k) % 4}', 'event': ev, **DETAIL.get(ev, {})})
    for d in range(3):
        lines.append({'at': iso(NOW - d * 86400 - 50), 'session': f'0000000{d}', 'event': 'session-summary', 'toolCalls': 180 + 40 * k,
                      'hookMs': (180 + 40 * k) * (3 + k % 4), 'maxHookMs': 40 + 25 * k, 'actions': {'turns': 30} if mod in ('hud', 'spinner-status') else {}})
    write(STATE / mod / f"{time.strftime('%Y-%m-%d', time.gmtime())}-demo.jsonl", ''.join(json.dumps(l) + '\n' for l in lines))
    installed[f'{mod}@cockpit'] = [{'version': '1.0.0', 'installPath': f'/demo/{mod}'}]
write(CONFIG / 'plugins' / 'installed_plugins.json', json.dumps({'plugins': installed}))
write(CONFIG / 'settings.json', json.dumps({'autoCompactWindow': 733000, 'enabledPlugins': {k: True for k in installed}}))

os.environ.update(CLAUDE_CONFIG_DIR=str(CONFIG), PANEL_STATE=str(STATE / 'panel'), PANEL_PORT=str(PORT), PANEL_CLAUDE='/bin/false')
sys.path.insert(0, str(HERE.parent / 'panel' / 'server'))
import panel  # noqa: E402

by_pid = {s['pid']: s for s in SESSIONS}
panel.git_state = lambda cwd: next((s['git'] for s in SESSIONS if s['cwd'] == cwd), None)
panel.listening = lambda sid: True
panel.Processes.tree_rss = lambda self, pid: by_pid[pid]['mem'] * 2 ** 20 if pid in by_pid else 0
GiB = 2 ** 30
# A laptop: no cgroups and no services, as on macOS and Windows
panel.groups = lambda pids, procs, now: []
panel.services = lambda g: []
panel.meminfo = lambda: {'total': 16 * GiB, 'available': 9.4 * GiB}
_overview = panel.overview
def overview(cards, procs, now):
    o = _overview(cards, procs, now)
    o.update(host='MacBook-Pro', cpu={'busy': 23, 'iowait': None, 'cores': 10}, disk={'used': 312 * GiB, 'total': 494 * GiB},
             panel={'summaries': 38, 'tokens': 912000, 'failed': 0, 'costUsd': 2.66})
    return o
panel.overview = overview
panel.Summarizer.request = lambda self, sid, reason: False

try:
    panel.main()
finally:
    for p in procs:
        p.kill()
