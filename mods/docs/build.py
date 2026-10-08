"""Builds the Cockpit docs site: one HTML file, every page rendered from the mods' own READMEs plus
the hand-written guides below. Needs python-markdown (pip install markdown). Run: python3 build.py
The sl-*.ansi files are real status line output, drawn by hud/statusline/statusline.sh."""
import html, json, re, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pylib'))
import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
MODS = os.path.dirname(HERE)
REPO = 'joaosavi/cockpit'

# --- ANSI to HTML, for the real status line output -------------------------------------------

BASIC = {30: '#3b4252', 31: '#e06c75', 32: '#7ec699', 33: '#e5c07b', 34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#d7dde0',
         90: '#6b7680', 91: '#ff7b86', 92: '#98e0a8', 93: '#f2d38a', 94: '#82c4ff', 95: '#d99cf0', 96: '#7fd8e3', 97: '#ffffff'}

def xterm(n):
    if n < 16:
        return BASIC.get(30 + n if n < 8 else 82 + n, '#d7dde0')
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return '#%02x%02x%02x' % (steps[n // 36], steps[(n // 6) % 6], steps[n % 6])
    v = 8 + (n - 232) * 10
    return '#%02x%02x%02x' % (v, v, v)

def ansi_to_html(text):
    out, st = [], {}
    pos = 0
    for m in re.finditer(r'\x1b\[([0-9;]*)m', text):
        chunk = text[pos:m.start()]
        if chunk:
            css = []
            if 'fg' in st: css.append('color:' + st['fg'])
            if 'bg' in st: css.append('background:' + st['bg'])
            if st.get('b'): css.append('font-weight:700')
            if st.get('d'): css.append('opacity:.55')
            if st.get('i'): css.append('font-style:italic')
            e = html.escape(chunk)
            out.append(f'<span style="{";".join(css)}">{e}</span>' if css else e)
        pos = m.end()
        codes = [int(c) for c in m.group(1).split(';') if c != ''] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0: st = {}
            elif c == 1: st['b'] = True
            elif c == 2: st['d'] = True
            elif c == 3: st['i'] = True
            elif c == 22: st.pop('b', None); st.pop('d', None)
            elif c == 23: st.pop('i', None)
            elif c == 39: st.pop('fg', None)
            elif c == 49: st.pop('bg', None)
            elif c in (38, 48) and i + 1 < len(codes):
                key = 'fg' if c == 38 else 'bg'
                if codes[i + 1] == 5 and i + 2 < len(codes):
                    st[key] = xterm(codes[i + 2]); i += 2
                elif codes[i + 1] == 2 and i + 4 < len(codes):
                    st[key] = '#%02x%02x%02x' % tuple(codes[i + 2:i + 5]); i += 4
            elif 30 <= c <= 37 or 90 <= c <= 97: st['fg'] = BASIC[c]
            elif 40 <= c <= 47: st['bg'] = BASIC[c - 10]
            i += 1
    tail = text[pos:]
    if tail: out.append(html.escape(tail))
    return ''.join(out)

def statusline(style, width):
    raw = open(os.path.join(HERE, f'sl-{style}-{width}.ansi')).read().rstrip('\n')
    return '\n'.join(ansi_to_html(l) for l in raw.split('\n'))

# --- markdown --------------------------------------------------------------------------------

def md(text):
    out = markdown.markdown(text, extensions=['tables', 'fenced_code', 'sane_lists'])
    return out

def mod_page(name):
    raw = open(f'{MODS}/{name}/README.md').read()
    raw = raw.replace('joaosavi/claude-devcontainer', REPO)
    raw = re.sub(r'^# .*\n', '', raw, count=1)
    return md(raw)

def meta(name):
    return json.load(open(f'{MODS}/{name}/.claude-plugin/plugin.json'))

# --- the pages -------------------------------------------------------------------------------

GROUPS = [
    ('Guards', 'Stop a mistake before it lands.', ['secret-guard', 'collision-guard', 'pipefail', 'memory-guard', 'loop-breaker', 'usage-limit']),
    ('Instruments', 'Show where the session stands.', ['hud', 'spinner-status', 'wtf', 'skill-loader']),
    ('Records', 'Keep what happened, for later.', ['rating', 'audit', 'mod-report']),
    ('Outside the bundle', 'Install on its own.', ['global-memory']),
]
COMMANDS = {'hud': ['/hud'], 'wtf': ['/wtf'], 'usage-limit': ['/limit'], 'memory-guard': ['/ram'], 'rating': ['/rate', '/ratings'],
            'audit': ['/audit'], 'mod-report': ['/mods']}
HAIKU = {'wtf', 'spinner-status'}

def term(lines, title='~/acme-api'):
    return f'<figure class="term"><div class="term-bar"><span></span><span></span><span></span><em>{title}</em></div><pre>{lines}</pre></figure>'

def code(text, lang='sh'):
    return f'<pre><code class="language-{lang}">{html.escape(text)}</code></pre>'

def note(kind, title, body):
    return f'<aside class="note {kind}"><strong>{title}</strong><div>{body}</div></aside>'

WTF_SAMPLE = (
    '<span class="t-dim">❯</span> /wtf\n'
    '  <span class="t-dim">⎿</span>  wtf: <span class="t-chip">WAITING</span>  <b>The agent wrote the demo file and asks whether to delete or keep it.</b>\n'
    '     <span class="t-acc">→ you:</span> answer 1 or 2\n'
    '        1. <b>Delete</b> <i>(recommended)</i>: nothing in the repo reads the file\n'
    '        2. <b>Keep</b>: it stays in /tmp until the reboot\n'
    '     <span class="t-dim">▎ summary, not an instruction  ·  haiku 935→174</span>'
)
SPINNER_SAMPLE = (
    '<span class="t-acc">✻</span> Propagating… <span class="t-dim">(6s · ↓ 90 tokens)</span>\n'
    '  <span class="t-dim">⎿</span>  <b>Now:</b> Running the tests after the fix to the date filter'
)
PROMPT_ROW = '<span class="t-rule">' + '─' * 90 + '</span>\n<span class="t-dim">❯</span> \n<span class="t-rule">' + '─' * 90 + '</span>'

def intro():
    hero = term(SPINNER_SAMPLE + '\n\n' + PROMPT_ROW + '\n' + statusline('refined', 90))
    cards = ''.join(
        f'<a class="pillar" href="#group-{g.split()[0].lower()}"><h3>{g}</h3><p>{d}</p><ul>' +
        ''.join(f'<li><code>{m}</code></li>' for m in ms[:4]) + ('<li class="more">and more</li>' if len(ms) > 4 else '') + '</ul></a>'
        for g, d, ms in GROUPS[:3])
    return f'''
<p class="lead">Cockpit is a set of mods for Claude Code. Guards catch the mistakes an agent makes when nobody is watching. Instruments show you where a session stands at a glance. Records keep what happened, so you can look back.</p>
{hero}
<p class="caption">A turn in progress: the spinner line from <code>spinner-status</code>, then the prompt, then the <code>hud</code> status line. Real output from the mods, in the <code>refined</code> style.</p>
<h2 id="intro-what">What is in the box</h2>
<div class="pillars">{cards}</div>
<p>Each mod is a Claude Code plugin with TypeScript hooks and its own tests. The <code>cockpit</code> plugin lists them all as dependencies, so one install brings the whole set. Every mod is optional: turn any of them off in <code>/plugin</code>.</p>
<h2 id="intro-how">How a mod works</h2>
<p>Claude Code raises events as it works: a tool call, a prompt, a turn ending, a screen being drawn. A mod hooks those events in TypeScript and can change what happens. <code>secret-guard</code> rewrites a tool result before the agent reads it. <code>pipefail</code> rewrites a command before it runs. <code>hud</code> draws rows that Claude Code does not draw. Nothing runs outside Claude Code: no daemon, no server, no account.</p>
<h2 id="intro-next">Next steps</h2>
<div class="next-grid">
  <a href="#install"><b>Install Cockpit</b><span>Two commands and a setup that asks four questions.</span></a>
  <a href="#first-session"><b>Your first session</b><span>What changes on screen, and the commands to try.</span></a>
  <a href="#mods"><b>Browse the mods</b><span>Fourteen mods, each with its options and its cost.</span></a>
</div>'''

def install():
    return f'''
<p class="lead">Install the bundle from the marketplace, restart Claude Code, then run the setup. It takes about five minutes.</p>
<h2 id="install-req">Requirements</h2>
<ul>
<li><b>Claude Code 2.1.287 or later.</b> Run <code>claude --version</code> to check. Mods use Claude Code's function hooks, which are in early access and can change between releases.</li>
<li><b>Node 22.18 or later</b>, for the status line script. Run <code>node --version</code> to check.</li>
<li><b>A Nerd Font</b> in your terminal, for the status line icons. This is optional: without one, choose the plain icons during setup.</li>
<li><b>Linux</b> for <code>memory-guard</code>, which reads Linux memory files. The other mods have no system requirement, but they are tested on Linux.</li>
</ul>
<h2 id="install-steps">Install</h2>
<ol class="steps">
<li><p>Add the marketplace and install the bundle:</p>{code(f"claude plugin marketplace add {REPO}{chr(10)}claude plugin install cockpit@cockpit")}
<p>The second command lists every mod it installs, as <code>+ 13 dependencies</code>.</p></li>
<li><p>Restart Claude Code, so the new session loads the mods.</p></li>
<li><p>Run the setup inside Claude Code:</p>{code('/cockpit:setup', 'text')}
<p>It asks four questions in one round, with a preview of each status line style drawn by the real script. Then it writes your settings, keeps a backup of the file it changed, and tells you what you will notice.</p></li>
</ol>
<h2 id="install-check">Check the install</h2>
{code('claude plugin list')}
<p>You should see 14 entries ending in <code>@cockpit</code>, each marked <code>enabled</code>. An entry marked <code>failed to load</code> points to a version mismatch; see <a href="#troubleshooting">Troubleshooting</a>.</p>
<h2 id="install-auto">Turn on automatic updates</h2>
<p>Open <code>/plugin</code>, go to <b>Marketplaces</b>, select <code>cockpit</code>, and choose <b>Enable auto-update</b>. A new version then installs when Claude Code starts, and a mod added to the bundle installs with it.</p>
{note('info', 'Coming from the agent marketplace', '<p>Cockpit was called <code>agent</code> before October 2026. Rename every <code>@agent</code> key to <code>@cockpit</code> in <code>~/.claude/settings.json</code>, then run <code>claude plugin marketplace remove agent</code> before the steps above. Removing a marketplace deletes the saved options of its plugins, so rename the keys first, or run <code>/cockpit:setup</code> again afterwards.</p>')}
'''

def first_session():
    return f'''
<p class="lead">After the setup and a restart, three things look different. This page shows each one and the commands worth trying first.</p>
<h2 id="first-status">The status line</h2>
<p>The <code>hud</code> draws two rows under the prompt: the model, the folder, the git branch and its changes, then the context window, the 5-hour and 7-day plan limits, and the memory headroom.</p>
{term(statusline('refined', 90))}
<p>The bars turn from green to red as they fill. The <code>resets 2h20m</code> countdown tells you when the 5-hour window frees up. See <a href="#statusline">Status line styles</a> for the other three looks.</p>
<h2 id="first-spinner">The line under the spinner</h2>
<p>While a turn runs, Claude Code normally shows a tip under the spinner. <code>spinner-status</code> replaces it with one line from Haiku about what the agent is doing right now.</p>
{term(SPINNER_SAMPLE)}
<p>The label says what the line is. <code>Now:</code> is where the session stands. <code>Mods:</code> is a tip about the mods you have.</p>
<h2 id="first-wtf">Ask where a session stands</h2>
<p>Come back to a session you forgot and type <code>/wtf</code>. It answers in a few lines, in the language you write in, and tells you what the agent needs from you.</p>
{term(WTF_SAMPLE)}
<p>It runs at once, also in the middle of a turn, and adds nothing to the conversation. Add a question to ask something specific: <code>/wtf why did the deploy stop?</code></p>
<h2 id="first-try">Commands to try</h2>
<table><thead><tr><th>Command</th><th>What you get</th></tr></thead><tbody>
<tr><td><code>/rate 4</code></td><td>Scores the last answer from 1 to 5. While the rating band shows, the digit alone does the same.</td></tr>
<tr><td><code>/limit</code></td><td>Both plan windows, when each resets, and what the mod holds back near the limit.</td></tr>
<tr><td><code>/mods</code></td><td>What each mod did today, and what it cost per tool call.</td></tr>
</tbody></table>
<p>The guards stay quiet until they act. When one does, the agent reads a short note that starts with the mod's name, such as <code>pipefail:</code> or <code>collision-guard:</code>, and usually tells you about it.</p>'''

def statusline_page():
    gal = ''
    for s, d in [('refined', 'Two rows with gradient bars. The default.'), ('blocks', 'Each field on its own colored background.'),
                 ('minimal', 'Fields spelled out in words, thin bars.'), ('compact', 'One row when it fits.')]:
        gal += f'<h3 id="sl-{s}"><code>{s}</code></h3><p>{d}</p>' + term(statusline(s, 90)) + '<p class="caption">At 64 columns:</p>' + term(statusline(s, 64))
    return f'''
<p class="lead">The <code>hud</code> status line comes in four styles. Each one fits itself to the terminal width, and drops the least important fields first.</p>
<h2 id="sl-styles">The four styles</h2>
<p>Every preview below is the real output of <code>statusline.sh</code> for the same session, at 90 and 64 columns.</p>
{gal}
<h2 id="sl-change">Change the style</h2>
<p>Open <code>/config</code> and change <b>Status line style</b> under <code>hud</code>, or run <code>/cockpit:setup</code> again to compare the previews. The change shows within five seconds.</p>
<h2 id="sl-icons">Icons</h2>
<p>With a Nerd Font, the branch, pull request and model use small icons. Without one, they show as boxes; set <b>Icons</b> to <code>unicode</code> to use plain arrows and marks that every terminal draws.</p>
<h2 id="sl-settings">What the setup writes</h2>
<p>A plugin cannot draw under the prompt by itself. That row belongs to the <code>statusLine</code> setting, so the setup points it at the script the <code>hud</code> ships:</p>
{code('{"statusLine": {"type": "command", "command": "~/.claude/plugins/marketplaces/cockpit/mods/hud/statusline/statusline.sh", "refreshInterval": 5}}', 'json')}
<p><code>refreshInterval</code> redraws the line every 5 seconds, so git and the countdowns stay current while the session is idle. The <a href="#mod-hud">hud reference</a> lists every option, including bar glyphs, colors and fields to hide.</p>'''

def configuration():
    return f'''
<p class="lead">Every mod option is a row in <code>/config</code>. The setup handles the few settings a plugin cannot write itself.</p>
<h2 id="cfg-config">Change an option</h2>
<p>Open <code>/config</code> and scroll to the mod. Each mod's page lists its options, their defaults and what they do. The status line picks up a change within five seconds; for the other mods, restart Claude Code or run <code>/reload-plugins</code>.</p>
<h2 id="cfg-file">Set options in the settings file</h2>
<p>The same options live under <code>pluginConfigs</code> in <code>~/.claude/settings.json</code>, keyed by <code>&lt;mod&gt;@cockpit</code>. This is useful to share a setup across machines:</p>
{code(json.dumps({"pluginConfigs": {"hud@cockpit": {"options": {"style": "blocks", "icons": "unicode"}}, "usage-limit@cockpit": {"options": {"timeZone": "Europe/Lisbon"}}, "collision-guard@cockpit": {"options": {"git": "note"}}}}, indent=2), 'json')}
<h2 id="cfg-setup">What the setup writes</h2>
<table><thead><tr><th>Setting</th><th>Value</th><th>Why</th></tr></thead><tbody>
<tr><td><code>statusLine</code></td><td>the <code>hud</code> script, <code>refreshInterval: 5</code></td><td>A plugin cannot draw under the prompt.</td></tr>
<tr><td><code>spinnerTipsEnabled</code></td><td><code>false</code></td><td>So the <code>spinner-status</code> line replaces Claude Code's tip instead of sitting under it.</td></tr>
<tr><td><code>autoCompactWindow</code></td><td><code>733000</code> on a 1M model, if you choose it</td><td>Claude Code summarizes the conversation at about 70% instead of near the end.</td></tr>
<tr><td><code>pluginConfigs</code></td><td>style, icons, time zone, ratings folder</td><td>Your answers to the setup questions.</td></tr>
</tbody></table>
<p>Run <code>/cockpit:setup</code> again at any time to change your answers. It reads what is set and asks only about what you want to change.</p>'''

def mods_index():
    out = '<p class="lead">Fourteen mods in three groups. The bundle installs the first thirteen; <code>global-memory</code> installs on its own.</p>'
    for g, d, ms in GROUPS:
        gid = g.split()[0].lower()
        out += f'<h2 id="group-{gid}">{g}</h2><p>{d}</p><div class="modgrid">'
        for m in ms:
            mt = meta(m)
            tags = ''.join(f'<span class="tag">{c}</span>' for c in COMMANDS.get(m, []))
            if m in HAIKU: tags += '<span class="tag haiku">calls Haiku</span>'
            out += f'<a class="modcard" href="#mod-{m}"><div class="mc-head"><code>{m}</code><span class="ver">{mt["version"]}</span></div><p>{html.escape(mt["description"])}</p><div class="tags">{tags}</div></a>'
        out += '</div>'
    return out

def commands():
    rows = [('/wtf [question]', 'wtf', 'Where this session stands and what it needs from you. Runs mid-turn.'),
            ('/hud', 'hud', 'The full heads-up display in a pane: session, limits, memory, now, today.'),
            ('/limit', 'usage-limit', 'Both plan windows, their resets, and what the mod holds back.'),
            ('/ram', 'memory-guard', 'Memory headroom per group and the measured peak of each heavy command.'),
            ('/rate 1-5 [tags] [-- note]', 'rating', 'Rates the last answer. Without a score, shows the current one.'),
            ('/ratings [days]', 'rating', 'Ratings, scores per project and per skill, the lowest-rated turns.'),
            ('/mods [days]', 'mod-report', 'What each mod did and its time cost per tool call.'),
            ('/audit [count] [filter]', 'audit', 'The latest MCP calls that wrote on your behalf.'),
            ('/cockpit:setup', 'cockpit', 'Runs the setup again.')]
    body = ''.join(f'<tr><td><code>{html.escape(c)}</code></td><td><a href="#mod-{m}">{m}</a></td><td>{d}</td></tr>' if m != 'cockpit' else f'<tr><td><code>{c}</code></td><td>cockpit</td><td>{d}</td></tr>' for c, m, d in rows)
    return f'''<p class="lead">Every command Cockpit adds. Each one also answers in plain text, so it works over Remote Control, where no pane is drawn.</p>
<table><thead><tr><th>Command</th><th>Mod</th><th>What it does</th></tr></thead><tbody>{body}</tbody></table>
<h2 id="cmd-keys">Keys inside a pane</h2>
<p>A pane opens on the right side of the screen. Press <code>r</code> to refresh it and <code>esc</code> to close it. While the rating band shows above the prompt, the digits <code>1</code> to <code>5</code> rate the last answer.</p>'''

def privacy():
    return f'''<p class="lead">Cockpit runs inside Claude Code on your machine. Two mods send an excerpt of the session to a model, through your own account. Everything else stays local.</p>
<h2 id="priv-out">What leaves your machine</h2>
<table><thead><tr><th>Mod</th><th>Sends</th><th>When</th></tr></thead><tbody>
<tr><td><code>wtf</code></td><td>A digest of the session, at most 12,000 characters, to Haiku</td><td>Once per <code>/wtf</code></td></tr>
<tr><td><code>spinner-status</code></td><td>The last few prompts and the agent's last text, at most 3,000 characters, to Haiku</td><td>Once per turn, or never in <code>tips</code> mode</td></tr>
<tr><td><code>hud</code></td><td>A <code>gh pr view</code> request for the current branch, to GitHub</td><td>At most once a minute, when <code>gh</code> is installed</td></tr>
</tbody></table>
<p>The Haiku calls use the same account and the same data terms as the rest of your Claude Code session.</p>
<h2 id="priv-local">What stays on your machine</h2>
<ul>
<li><b>Diaries.</b> Every mod writes one line per action under <code>~/.local/state/mods/&lt;mod&gt;/</code>, and one summary per session. A diary never holds a secret value or a file's content. <code>/mods</code> reads them.</li>
<li><b>Ratings.</b> <code>rating</code> keeps every turn in <code>~/datasets/agent-ratings</code>: prompts, answers and tool output in plain text. Keep that folder private, or turn the mod off.</li>
<li><b>Session records.</b> <code>collision-guard</code> keeps the list of files each session edited, under <code>~/.local/state/mods/collision-guard/sessions/</code>, and removes it once the session has ended.</li>
<li><b>Secrets.</b> <code>secret-guard</code> holds secret values in memory only, never on disk.</li>
</ul>'''

def troubleshooting():
    items = [
        ('The status line does not show, or only changes when a message arrives', '<p>The <code>statusLine</code> setting is missing, or has no <code>refreshInterval</code>. Run <code>/cockpit:setup</code> again, then restart Claude Code.</p>'),
        ('The status line shows nothing at all', '<p>The script needs Node 22.18 or later. Run <code>node --version</code>, and update Node if it is older.</p>'),
        ('Icons show as boxes or question marks', '<p>The terminal font has no Nerd Font glyphs. Set <b>Icons</b> to <code>unicode</code> under <code>hud</code> in <code>/config</code>, or install a Nerd Font and select it in your terminal.</p>'),
        ('The bars look like a single blurred shape', '<p>Some fonts draw the bar glyphs joined together. Set <b>Bar style</b> under <code>hud</code> to <code>dots</code> or <code>squares</code>.</p>'),
        ('Two lines show under the spinner', '<p>Claude Code\'s own tip is still on. Set <code>"spinnerTipsEnabled": false</code> in your settings, or run the setup again.</p>'),
        ('A mod shows "failed to load" in claude plugin list', '<p>The marketplace copy and the installed version are out of step. Run <code>claude plugin marketplace update cockpit</code>, then <code>claude plugin update cockpit@cockpit</code>, and restart.</p>'),
        ('The mod options are gone', '<p>Removing a marketplace deletes the saved options of its plugins. Run <code>/cockpit:setup</code> again to write them back.</p>'),
        ('/rate says this session records nothing', '<p>The session runs in a temporary folder such as <code>/tmp</code>, and <code>rating</code> skips those so test runs stay out of your dataset. Turn off <b>Skip test sessions</b> under <code>rating</code> in <code>/config</code> to record them.</p>'),
        ('global-memory does nothing on a Team or Enterprise plan', '<p>Those plans run a built-in guard that skips user-installed plugins on the hooks <code>global-memory</code> needs. It must run as an organization plugin; its <a href="#mod-global-memory">page</a> shows the managed settings.</p>'),
        ('A git command was refused with a list of files', '<p><code>collision-guard</code> held it, because another session on this machine has uncommitted edits in the same repo. Name your own files instead, or run the same command again within 2 minutes.</p>'),
    ]
    out = '<p class="lead">The problems people hit most, and the fix for each.</p>'
    for i, (q, a) in enumerate(items):
        out += f'<h2 id="ts-{i}">{q}</h2>{a}'
    return out

def update():
    return f'''<p class="lead">With auto-update on, new versions install when Claude Code starts. You can also update by hand, and remove everything in two commands.</p>
<h2 id="up-manual">Update by hand</h2>
{code('claude plugin marketplace update cockpit' + chr(10) + 'claude plugin update cockpit@cockpit')}
<p>Claude Code has no command that updates every plugin at once. To update one mod, name it: <code>claude plugin update hud@cockpit</code>. A session that is already open keeps the old version until you run <code>/reload-plugins</code> or restart.</p>
<h2 id="up-remove">Uninstall</h2>
{code('claude plugin uninstall cockpit@cockpit' + chr(10) + 'claude plugin prune')}
<p>Uninstalling the bundle leaves the mods installed; <code>claude plugin prune</code> removes them. The setup wrote <code>statusLine</code>, <code>spinnerTipsEnabled</code> and <code>autoCompactWindow</code> to your settings file and kept a backup next to it. Remove those keys by hand, or restore the backup.</p>
<h2 id="up-data">Remove the data</h2>
<p>The mods leave their diaries in <code>~/.local/state/mods/</code> and the ratings in <code>~/datasets/agent-ratings</code>. Delete those folders to remove everything Cockpit wrote.</p>'''

def versions():
    names = [m for _, _, ms in GROUPS for m in ms]
    rows = ''.join(f'<tr><td><a href="#mod-{m}"><code>{m}</code></a></td><td class="num">{meta(m)["version"]}</td><td class="num">{len(meta(m).get("userConfig", {}))}</td></tr>' for m in ['cockpit'] + names if m != 'cockpit')
    return f'''<p class="lead">The version of each mod in this release. Each mod keeps its own version, so an update to one leaves the others as they are.</p>
<table><thead><tr><th>Mod</th><th>Version</th><th>Options</th></tr></thead><tbody><tr><td><code>cockpit</code> (bundle)</td><td class="num">{meta("cockpit")["version"]}</td><td class="num">0</td></tr>{rows}</tbody></table>'''

PAGES = [
    ('Get started', [('intro', 'Introduction', intro), ('install', 'Installation', install), ('first-session', 'Your first session', first_session), ('update', 'Update and uninstall', update)]),
    ('Guides', [('statusline', 'Status line styles', statusline_page), ('configuration', 'Configuration', configuration)]),
    ('Mods', [('mods', 'All mods', mods_index)] + [(f'mod-{m}', m, None) for _, _, ms in GROUPS for m in ms]),
    ('Reference', [('commands', 'Commands', commands), ('privacy', 'Data and privacy', privacy), ('troubleshooting', 'Troubleshooting', troubleshooting), ('versions', 'Versions', versions)]),
]

def page_id_headings(pid, body):
    seen = set()
    def rep(m):
        lvl, attrs, inner = m.group(1), m.group(2), m.group(3)
        if 'id=' in attrs: return m.group(0)
        slug = re.sub(r'[^a-z0-9]+', '-', re.sub(r'<[^>]+>', '', inner).lower()).strip('-')[:40] or 'section'
        hid = f'{pid}-{slug}'
        while hid in seen: hid += '-2'
        seen.add(hid)
        return f'<h{lvl} id="{hid}"{attrs}>{inner}</h{lvl}>'
    return re.sub(r'<h([23])([^>]*)>(.*?)</h\1>', rep, body)

def build():
    nav, pages, flat = '', '', []
    for section, items in PAGES:
        nav += f'<div class="nav-sec"><h4>{section}</h4>'
        if section == 'Mods':
            nav += f'<a href="#mods" data-page="mods">All mods</a>'
            for g, _, ms in GROUPS:
                nav += f'<h5>{g}</h5>' + ''.join(f'<a href="#mod-{m}" data-page="mod-{m}" class="mono">{m}</a>' for m in ms)
        else:
            nav += ''.join(f'<a href="#{pid}" data-page="{pid}">{title}</a>' for pid, title, _ in items)
        nav += '</div>'
        for pid, title, fn in items:
            flat.append((pid, title, section, fn))
    for i, (pid, title, section, fn) in enumerate(flat):
        if fn is None:
            m = pid[4:]
            mt = meta(m)
            group = next(g for g, _, ms in GROUPS if m in ms)
            chips = ''.join(f'<span class="tag">{c}</span>' for c in COMMANDS.get(m, [])) + ('<span class="tag haiku">calls Haiku</span>' if m in HAIKU else '')
            install = f'claude plugin install {m}@cockpit'
            head = f'<div class="modmeta"><span>v{mt["version"]}</span><span>{group}</span>{chips}<code class="inst">{install}</code></div>'
            body = head + re.sub(r'^\s*<p>', '<p class="lead">', mod_page(m), count=1)
            title_html = f'<code>{m}</code>'
        else:
            body = fn()
            title_html = title
        body = page_id_headings(pid, body)
        prev_ = flat[i - 1] if i > 0 else None
        next_ = flat[i + 1] if i + 1 < len(flat) else None
        pager = '<nav class="pager">'
        pager += f'<a class="prev" href="#{prev_[0]}"><small>Previous</small><span>{prev_[1]}</span></a>' if prev_ else '<span></span>'
        pager += f'<a class="next" href="#{next_[0]}"><small>Next</small><span>{next_[1]}</span></a>' if next_ else '<span></span>'
        pager += '</nav>'
        src = f'<a class="src" href="https://github.com/{REPO}/blob/main/mods/{pid[4:]}/README.md" target="_blank" rel="noopener">Edit this page on GitHub</a>' if fn is None else ''
        pages += f'<article class="page" id="p-{pid}" data-title="{html.escape(title)}" data-section="{section}" hidden><div class="crumb">{section}</div><h1>{title_html}</h1>{body}{src}{pager}</article>'
    tpl = open(os.path.join(HERE, 'shell.html')).read()
    out = tpl.replace('{{NAV}}', nav).replace('{{PAGES}}', pages)
    open(os.path.join(HERE, 'cockpit-docs.html'), 'w').write(out)
    print('pages', len(flat), 'bytes', len(out))

build()
