"""Builds the Cockpit docs site: one HTML file, every page rendered from the mods' own READMEs plus
the hand-written guides below. Needs python-markdown (pip install markdown). Run: python3 build.py
The sl-*.ansi files are real status line output, drawn by hud/statusline/statusline.sh."""
import base64, html, json, re, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pylib'))
import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
MODS = os.path.dirname(HERE)
REPO = 'joaosavi/cockpit'
# Updating the bundle does not update its dependencies, so a manual update names every mod.
UPDATE_ALL = 'claude plugin marketplace update cockpit\n' + "for m in $(claude plugin list | grep -o '[a-z-]*@cockpit'); do claude plugin update \"$m\"; done"

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
    ('Instruments', 'Show where the session stands.', ['hud', 'spinner-status', 'panel', 'skill-loader']),
    ('Memory', 'Carry what you learned into every session.', ['global-memory', 'todo']),
]
COMMANDS = {'hud': ['/hud'], 'panel': ['/panel'], 'usage-limit': ['/limit'], 'memory-guard': ['/ram']}
MODEL_TAGS = {'spinner-status': 'calls Haiku', 'panel': 'calls claude -p'}

def term(lines, title='~/acme-api'):
    return f'<figure class="term"><div class="term-bar"><span></span><span></span><span></span><em>{title}</em></div><pre>{lines}</pre></figure>'

def code(text, lang='sh'):
    return f'<pre><code class="language-{lang}">{html.escape(text)}</code></pre>'

def shot(light, dark=None, alt='', url='localhost:7777'):
    """A screenshot of the panel in a browser frame, from shots/; with `dark`, the image follows the theme."""
    def img(name, cls):
        data = base64.b64encode(open(os.path.join(HERE, 'shots', name), 'rb').read()).decode()
        return f'<img class="{cls}" src="data:image/png;base64,{data}" alt="{html.escape(alt)}" loading="lazy">'
    imgs = img(light, 'light has-dark' if dark else 'light') + (img(dark, 'dark') if dark else '')
    return f'<figure class="shot"><div class="shot-bar"><span></span><span></span><span></span><em>{url}</em></div>{imgs}</figure>'

def note(kind, title, body):
    return f'<aside class="note {kind}"><strong>{title}</strong><div>{body}</div></aside>'

PANEL_SAMPLE = (
    '<span class="t-dim">❯</span> /panel\n'
    '  <span class="t-dim">⎿</span>  panel: http://localhost:7777\n'
    '     4 sessions: <b class="t-warn">1 need you</b>, <span class="t-acc">2 working</span>.'
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
        for g, d, ms in GROUPS)
    return f'''
<p class="lead">Cockpit is a set of mods for Claude Code. Guards catch the mistakes an agent makes when nobody is watching. Instruments show you where a session stands at a glance. Memory carries facts about the machine into every session.</p>
{hero}
<p class="caption">A turn in progress: the spinner line from <code>spinner-status</code>, then the prompt, then the <code>hud</code> status line. Real output from the mods, in the <code>refined</code> style.</p>
<h2 id="intro-what">What is in the box</h2>
<div class="pillars">{cards}</div>
<p>Each mod is a Claude Code plugin with TypeScript hooks and its own tests. The <code>cockpit</code> plugin lists them all as dependencies, so one install brings the whole set. To leave one out, see <a href="#configuration-off">Turn one mod off</a>.</p>
<h2 id="intro-how">How a mod works</h2>
<p>Claude Code raises events as it works: a tool call, a prompt, a turn ending, a screen being drawn. A mod hooks those events in TypeScript and can change what happens. <code>secret-guard</code> rewrites a tool result before the agent reads it. <code>pipefail</code> rewrites a command before it runs. <code>hud</code> draws rows that Claude Code does not draw.</p>
<p>Every mod runs inside Claude Code, with one exception: <code>panel</code> starts a small web server on <code>127.0.0.1</code>, so you can see every session from a browser. There is no account and no cloud service.</p>
<h2 id="intro-panel">Every session on one page</h2>
<p>The <code>panel</code> page puts every Claude Code session on the machine side by side: which ones wait for you, what each one needs, what the agent is doing now, and how the machine holds up. You can answer a session from the page.</p>
{shot('panel-light.png', 'panel-dark.png', 'The Cockpit panel with four sessions: one waiting for a decision, one blocked, one working, one done')}
<p class="caption">The panel with made-up sessions. See <a href="#panel-guide">The session panel</a>.</p>
<h2 id="intro-next">Next steps</h2>
<div class="next-grid">
  <a href="#install"><b>Install Cockpit</b><span>Two commands and a setup that asks four questions.</span></a>
  <a href="#first-session"><b>Your first session</b><span>What changes on screen, and the commands to try.</span></a>
  <a href="#panel-guide"><b>The session panel</b><span>Every session on one page, and how to answer one from it.</span></a>
  <a href="#mods"><b>Browse the mods</b><span>Eleven mods, each with its options and its cost.</span></a>
</div>'''

def install():
    return f'''
<p class="lead">Install the bundle from the marketplace, restart Claude Code, then run the setup. It takes about five minutes.</p>
<h2 id="install-req">Requirements</h2>
<ul>
<li><b>Claude Code 2.1.287 or later.</b> Run <code>claude --version</code> to check. Mods use Claude Code's function hooks, which are in early access and can change between releases.</li>
<li><b>Node 22.18 or later</b>, for the status line script. Run <code>node --version</code> to check.</li>
<li><b>A Nerd Font</b> in your terminal, for the status line icons. This is optional: without one, choose the plain icons during setup.</li>
<li><b>Python 3.9 or later and <code>curl</code></b>, for the <code>panel</code> page. macOS ships both, and Windows 10 or later ships <code>curl</code>. On Windows, install Python from python.org or the Microsoft Store.</li>
</ul>
<p>The status line, the spinner line and the panes are part of Claude Code's terminal interface. Run <code>claude</code> in a terminal: Terminal or iTerm on macOS, Windows Terminal or PowerShell on Windows, or the terminal panel of VS Code or JetBrains. The mods are tested only in the terminal interface, not in the Desktop app or in the chat panel of the IDE extensions.</p>
<h2 id="install-os">macOS, Windows and Linux</h2>
<p>Every mod runs on all three systems, and they are tested on Linux only. Two things differ:</p>
<ul>
<li><code>memory-guard</code> and the memory figure of the <code>hud</code> read cgroup limits and <code>/proc/meminfo</code> on Linux. On macOS they read <code>vm_stat</code> and on Windows PowerShell, and there they compare against the whole machine's memory. The macOS and Windows readings are tested only against simulated output.</li>
<li>The <code>panel</code> page shows memory by cgroup, systemd services and the share of CPU time spent waiting on disk only on Linux.</li>
</ul>
<p>On Windows, the setup points the status line at Node instead of the <code>.sh</code> script, because PowerShell cannot run a shell script. The Limits section of each mod's page says what changes on each system.</p>
<h2 id="install-steps">Install</h2>
<ol class="steps">
<li><p>Add the marketplace and install the bundle:</p>{code(f"claude plugin marketplace add {REPO}{chr(10)}claude plugin install cockpit@cockpit")}
<p>The second command lists every mod it installs, as <code>+ 11 dependencies</code>.</p></li>
<li><p>Restart Claude Code, so the new session loads the mods.</p></li>
<li><p>Run the setup inside Claude Code:</p>{code('/cockpit:setup', 'text')}
<p>It asks four questions in one round, with a preview of each status line style drawn by the real script. Then it writes your settings, keeps a backup of the file it changed, and tells you what you will notice.</p></li>
</ol>
<h2 id="install-check">Check the install</h2>
{code('claude plugin list')}
<p>You should see 12 entries ending in <code>@cockpit</code>, each marked <code>enabled</code>. An entry marked <code>failed to load</code> points to a version mismatch; see <a href="#troubleshooting">Troubleshooting</a>.</p>
<h2 id="install-auto">Updates install by themselves</h2>
<p>The setup turns on auto-update for the <code>cockpit</code> marketplace. A few minutes after the first message of a session, Claude Code updates every mod that has a new version, installs any mod added to the bundle, and shows <code>Plugin updated: &lt;name&gt; · Run /reload-plugins to apply</code>. To turn it off, open <code>/plugin</code>, go to <b>Marketplaces</b>, and select <code>cockpit</code>.</p>
<h2 id="install-team">On a Team or Enterprise plan</h2>
<p>Every mod works the same on every plan, except <code>global-memory</code>. Team and Enterprise plans run a built-in guard that skips plugins you install yourself on the two hooks it needs, so it installs and does nothing. To use it, your organization adds it to managed settings, ahead of the guard:</p>
{code(json.dumps({'enabledPlugins': {'global-memory@cockpit': True}, 'prependPlugins': ['global-memory@cockpit', 'sec-default@builtin']}, indent=2), 'json')}
<p>Without those settings, nothing breaks: the other mods run as usual.</p>
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
<h2 id="first-panel">The session panel</h2>
<p><code>panel</code> starts a local web page with every session on the machine. Type <code>/panel</code> for its address.</p>
{term(PANEL_SAMPLE)}
<p>Open the address in a browser. A session that waits for you comes first, with the options it offered as buttons. <a href="#panel-guide">The session panel</a> walks through the page and its five views.</p>
<h2 id="first-try">Commands to try</h2>
<table><thead><tr><th>Command</th><th>What you get</th></tr></thead><tbody>
<tr><td><code>/limit</code></td><td>Both plan windows, when each resets, and what the mod holds back near the limit.</td></tr>
<tr><td><code>/hud</code></td><td>The full heads-up display in a pane: session, limits, memory, what runs now, and today's mod actions.</td></tr>
</tbody></table>
<p>The guards stay quiet until they act. When one does, the agent reads a short note that starts with the mod's name, such as <code>pipefail:</code> or <code>collision-guard:</code>, and usually tells you about it.</p>'''

def panel_guide():
    return f'''
<p class="lead">The panel is a local web page with every Claude Code session on your computer, the computer itself, and an audit of the mods. Open it in a browser tab beside your sessions.</p>
{shot('panel-light.png', 'panel-dark.png', 'The Cockpit panel in the Inbox view: the machine in the header, the sessions by urgency on the left, and the selected session on the right')}
<h2 id="pg-open">Open the page</h2>
<p>The server starts with the first session after you install the mod, and keeps running after that session ends. Type <code>/panel</code> in any session for the address, which is <code>http://localhost:7777</code> by default.</p>
<p>The page listens only on <code>127.0.0.1</code>, so only your own computer reaches it. When the sessions run on another machine, see <a href="#server">Running on a server</a>.</p>
<h2 id="pg-read">Read the page</h2>
<div class="feature-grid">
<div><b>The header</b><span>The plan's 5-hour and weekly usage, memory, the CPU over the last minute, disk, and the tokens of the last 24 hours by hour. On a narrow screen only the 5-hour usage stays.</span></div>
<div><b>The views</b><span>Five layouts of the same sessions, with the same actions in each. Each session shows its state, a summary of where the task stands, what it needs from you, the tool running now, git, context and memory.</span></div>
<div><b>The Mods drawer</b><span>The computer in full, the latest actions of the guards, what each did today, the summaries made today with their API price, and the audit of the mods. On Linux, also memory by cgroup and systemd services.</span></div>
</div>
<h2 id="pg-views">Pick a view</h2>
<p>The switcher under the header picks the view, and the page remembers your choice. The address also takes the view as its hash, such as <code>#board</code>.</p>
<table><thead><tr><th>View</th><th>What it shows</th><th>Keys</th></tr></thead><tbody>
<tr><td><b>Inbox</b></td><td>The default. The sessions by urgency on the left, and the selected one in full on the right. Ended sessions wait in a closed group at the bottom.</td><td><code>j</code> and <code>k</code> or the arrows move, <code>1</code> to <code>4</code> pick an option, <code>r</code> goes to the reply field</td></tr>
<tr><td><b>Board</b></td><td>Columns by state, with small cards. A card opens the full session in a side drawer, with arrows to the previous and next session. The <b>Ended</b> button adds a column for ended sessions.</td><td><code>1</code> to <code>4</code> pick an option in the drawer, the arrows move, <code>esc</code> closes it</td></tr>
<tr><td><b>Deck</b></td><td>A grid of full cards, with filters for all sessions, the ones that need you, working, done and ended.</td><td></td></tr>
<tr><td><b>Focus</b></td><td>One large card for the session that needs you most, and the others below. When nothing needs you, it says so.</td><td><code>n</code> and <code>p</code> or the arrows move, <code>1</code> to <code>4</code> pick an option</td></tr>
<tr><td><b>Timeline</b></td><td>A row per session with its tokens hour by hour over the last 24 hours, and a row for all sessions together. A row opens in place to show the full session.</td><td></td></tr>
</tbody></table>
<p>A session's state comes from two places. <b>Working</b> comes from Claude Code itself, as soon as a turn starts. <b>Waiting for you</b>, <b>Blocked</b>, <b>Done</b> and <b>Idle</b> come from the summary, which <code>claude -p</code> writes from the session's transcript. A summary is written 20 seconds after a turn ends, every 5 minutes for a session that changed, and when you press <b>Refresh</b>. An amber dot beside <b>Summarized</b> means the session moved on since then.</p>
<p>The bars turn amber at 75% and red at 90%. The context bar fills toward the point where Claude Code compacts the conversation, not toward the model's full window. <b>CPU, last minute</b> is the share of CPU time that was not idle over the last minute, across all cores; on Linux, the share spent waiting on disk shows under it when it reaches 5%.</p>
<h2 id="pg-answer">Answer a session</h2>
<p>When a session waits for a decision, every view lists the options the agent offered, with the recommended one marked. Press an option, or its number key, check the text in the dialog, and press <b>Send</b>. The reply field sends any text the same way. Once sent, the answer shows in place of the question until the next summary arrives.</p>
<p>The page leaves the text in the session's inbox. The <code>panel</code> mod in that session checks the inbox every 2 seconds and submits the text as your prompt, and Claude Code runs it once the session is idle. This works in any session that runs the mod, with or without tmux.</p>
{note('info', 'Options you cannot press', '<p>A session takes answers only when its session checked the inbox in the last 15 seconds. Until then its options are greyed out and its reply field is hidden. A session that loaded an older <code>panel</code> mod stays that way until you run <code>/reload-plugins</code> in it. When a session does not take a message within 6 seconds, the page withdraws it and says so.</p>')}
<h2 id="pg-mods">Audit the mods</h2>
<p>The <b>Mods</b> button opens a drawer with the computer in full and, below it, the audit of the mods. The audit reads every Cockpit mod's diary for the last day, 7 days or 30 days. Each row shows what the mod did, its failures in red, the time its hooks added per tool call, its slowest call, and the API cost of its model calls. Click a row to see its recent actions with their details.</p>
<p>The API cost is what the same calls would cost at Anthropic's API list prices. On a Pro or Max plan they spend plan usage, not money. Only <code>panel</code> and <code>spinner-status</code> call a model.</p>
{shot('panel-mods.png', None, 'The Mods drawer: the computer, the guards, and one row per mod with its actions, failures and time per tool call')}
<p>Use it to decide what earns its place. A mod with nothing recorded for a week does no work on your machine. A slowest call over 10 seconds, shown in red, is worth a look in the mod's diary.</p>
<h2 id="pg-notify">Get notified</h2>
<p>Press <b>Notify</b> and allow notifications. The browser then tells you when a session starts waiting for you or gets blocked, while the tab stays open. The tab title also counts the sessions that need you, as <code>(2) Cockpit</code>. Press <code>r</code> to summarize every session again; in Inbox, where <code>r</code> goes to the reply field, press <code>R</code>.</p>
<p>The <a href="#mod-panel">panel reference</a> lists every option and environment variable, and where each figure on the page comes from.</p>'''

def server():
    return f'''
<p class="lead">Most people run Claude Code on their own computer, and nothing on this page applies to them. If you run it on a remote Linux machine over SSH, the mods work the same, and a few parts do more.</p>
<h2 id="srv-panel">Open the panel through a tunnel</h2>
<p>The page listens only on <code>127.0.0.1</code> of the machine where the sessions run. From your computer, open an SSH tunnel, then open <code>http://localhost:7777</code>. In a session opened over SSH, <code>/panel</code> prints this command with the machine's name.</p>
{code('ssh -N -L 7777:127.0.0.1:7777 my-server')}
<p>To open the tunnel with every SSH login, add one line to the host's entry in <code>~/.ssh/config</code> on your computer:</p>
{code('Host my-server' + chr(10) + '  LocalForward 7777 127.0.0.1:7777', 'text')}
<h2 id="srv-service">Run the panel as a service</h2>
<p>Instead of letting a session start the page, run it under systemd. Set the <code>panel</code> option <b>Start the page</b> (<code>autostart</code>) to off, then run the server as a unit:</p>
{code("""[Service]
User=you
ExecStart=/usr/bin/python3 -I /home/you/.claude/plugins/marketplaces/cockpit/panel/server/panel.py
Environment=PANEL_CLAUDE=/home/you/.local/bin/claude
Restart=always""", 'ini')}
<p>Set <code>PANEL_GROUPS</code> to a comma-separated list of cgroup paths, such as <code>agents.slice</code>, to show those groups and everything under them on the page.</p>
<h2 id="srv-memory">Memory limits</h2>
<p>When sessions run under a cgroup v2 memory limit, as a systemd service or a container sets, <code>memory-guard</code> keeps heavy commands under the tightest limit, the <code>hud</code> shows the room left under it, <code>/ram</code> shows each group, and the panel shows each group's memory and the state of its systemd services.</p>
<h2 id="srv-remote">Remote Control and tmux</h2>
<p>Every Cockpit command also answers in plain text, so it works when you drive a session over Remote Control from claude.ai or the mobile app, where no pane is drawn. The panel links a session to claude.ai when the session runs with Remote Control. For a session that runs in tmux, its <b>tmux</b> button copies the command that attaches to its pane.</p>'''

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
{code('{"statusLine": {"type": "command", "command": "~/.claude/plugins/marketplaces/cockpit/hud/statusline/statusline.sh", "refreshInterval": 5}}', 'json')}
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
<tr><td><code>pluginConfigs</code></td><td>style, icons, time zone</td><td>Your answers to the setup questions.</td></tr>
</tbody></table>
<p>Run <code>/cockpit:setup</code> again at any time to change your answers. It reads what is set and asks only about what you want to change.</p>
<h2 id="configuration-off">Turn one mod off</h2>
<p>Every mod has an <b>Enabled</b> option in <code>/config</code>: turn it off, then start a new session or run <code>/reload-plugins</code>. The guards also have one switch per step, listed on each mod's page. To remove a mod's hooks entirely, disable the bundle first, then the mod, because Claude Code refuses to disable a plugin that an enabled plugin requires:</p>
{code('claude plugin disable cockpit@cockpit' + chr(10) + 'claude plugin disable pipefail@cockpit')}
<p>The other mods stay on. Enabling the bundle again turns the mod back on.</p>'''

def mods_index():
    out = '<p class="lead">Eleven mods in three groups. The <code>cockpit</code> bundle installs all of them.</p>'
    for g, d, ms in GROUPS:
        gid = g.split()[0].lower()
        out += f'<h2 id="group-{gid}">{g}</h2><p>{d}</p><div class="modgrid">'
        for m in ms:
            mt = meta(m)
            tags = ''.join(f'<span class="tag">{c}</span>' for c in COMMANDS.get(m, []))
            if m in MODEL_TAGS: tags += f'<span class="tag haiku">{MODEL_TAGS[m]}</span>'
            out += f'<a class="modcard" href="#mod-{m}"><div class="mc-head"><code>{m}</code><span class="ver">{mt["version"]}</span></div><p>{html.escape(mt["description"])}</p><div class="tags">{tags}</div></a>'
        out += '</div>'
    return out

def commands():
    rows = [('/panel', 'panel', 'The address of the page with every session on this computer, and how many need you.'),
            ('/hud', 'hud', 'The full heads-up display in a pane: session, limits, memory, now, today.'),
            ('/limit', 'usage-limit', 'Both plan windows, their resets, and what the mod holds back.'),
            ('/ram', 'memory-guard', 'Memory headroom per group, or of the machine, and the measured peak of each heavy command.'),
            ('/cockpit:setup', 'cockpit', 'Runs the setup again.')]
    body = ''.join(f'<tr><td><code>{html.escape(c)}</code></td><td><a href="#mod-{m}">{m}</a></td><td>{d}</td></tr>' if m != 'cockpit' else f'<tr><td><code>{c}</code></td><td>cockpit</td><td>{d}</td></tr>' for c, m, d in rows)
    return f'''<p class="lead">Every command Cockpit adds. Each one also answers in plain text, so it works where no pane is drawn, such as Remote Control.</p>
<table><thead><tr><th>Command</th><th>Mod</th><th>What it does</th></tr></thead><tbody>{body}</tbody></table>
<h2 id="cmd-keys">Keys inside a pane</h2>
<p>A pane opens on the right side of the screen. Press <code>r</code> to refresh it and <code>esc</code> to close it.</p>
<h2 id="cmd-panel-keys">Keys on the panel page</h2>
<p>Press <code>r</code> to summarize every session again, or <code>R</code> in Inbox. <code>esc</code> closes the send dialog, then the Mods drawer, then the Board drawer. Each view adds its own keys, listed in <a href="#pg-views">Pick a view</a>.</p>'''

def privacy():
    return f'''<p class="lead">Cockpit runs inside Claude Code on your machine. Two mods send an excerpt of the session to a model, through your own account. Everything else stays local.</p>
<h2 id="priv-out">What leaves your machine</h2>
<table><thead><tr><th>Mod</th><th>Sends</th><th>When</th></tr></thead><tbody>
<tr><td><code>panel</code></td><td>An excerpt of each session's transcript, through <code>claude -p</code> to <code>sonnet</code> by default</td><td>On <b>Refresh</b>, when a session goes idle after a turn, and every 5 minutes for a session that changed</td></tr>
<tr><td><code>spinner-status</code></td><td>The last few prompts and the agent's last text, at most 3,000 characters, to Haiku</td><td>Once per turn, or never in <code>tips</code> mode</td></tr>
<tr><td><code>hud</code></td><td>A <code>gh pr view</code> request for the current branch, to GitHub</td><td>At most once a minute, when <code>gh</code> is installed</td></tr>
</tbody></table>
<p>These calls use the same account and the same data terms as the rest of your Claude Code session.</p>
<h2 id="priv-local">What stays on your machine</h2>
<ul>
<li><b>Diaries.</b> Every mod writes one line per action under <code>~/.local/state/mods/&lt;mod&gt;/</code>, and one summary per session. A diary never holds a secret value or a file's content.</li>
<li><b>Session records.</b> <code>collision-guard</code> keeps the list of files each session edited, under <code>~/.local/state/mods/collision-guard/sessions/</code>, and removes it once the session has ended.</li>
<li><b>Secrets.</b> <code>secret-guard</code> holds secret values in memory only, never on disk.</li>
<li><b>The panel page.</b> <code>panel</code> keeps the last summary of each session under <code>~/.local/state/mods/panel/</code>. The page has no login and listens only on <code>127.0.0.1</code>. Anyone who can reach that port on the machine can read it and type into your sessions, so do not expose it.</li>
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
        ('global-memory does nothing on a Team or Enterprise plan', '<p>Those plans run a built-in guard that skips user-installed plugins on the hooks <code>global-memory</code> needs. It must run as an organization plugin; its <a href="#mod-global-memory">page</a> shows the managed settings.</p>'),
        ('/panel says the page server is not running', '<p>The server starts when a session starts, unless <b>Start the page</b> (<code>autostart</code>) is off. Check that Python 3.9 or later is installed as <code>python3</code>, <code>python</code> or <code>py</code>, and that <code>curl</code> runs, then start a new session. The server writes its errors to <code>~/.local/state/mods/panel/server.log</code>. If a service manager runs the server, check the service.</p>'),
        ('The panel greys out the options of a session', '<p>The session has not checked its inbox in the last 15 seconds, usually because it loaded an older <code>panel</code> mod. Run <code>/reload-plugins</code> in that session.</p>'),
        ('The Mods drawer shows no memory or services box', '<p>That is expected on macOS and Windows. The page shows memory by group only for Linux cgroup v2 groups with a memory limit, and services only under systemd. Elsewhere it shows the machine\'s memory alone, in the header and the drawer.</p>'),
        ('/ram says there is no memory reading', '<p><code>memory-guard</code> found no <code>/proc/meminfo</code>, and the system command failed: <code>sysctl</code> and <code>vm_stat</code> on macOS, or PowerShell on Windows, missing or slower than its timeout. Until a reading works, heavy commands run as written.</p>'),
        ('A git command was refused with a list of files', '<p><code>collision-guard</code> held it, because another session on this machine has uncommitted edits in the same repo, under the paths the command names. Name your own files instead, or run the same command again within 2 minutes.</p>'),
    ]
    out = '<p class="lead">The problems people hit most, and the fix for each.</p>'
    for i, (q, a) in enumerate(items):
        out += f'<h2 id="ts-{i}">{q}</h2>{a}'
    return out

def update():
    return f'''<p class="lead">Updates arrive by themselves, a few minutes after the first message of a session. You can also update by hand, and remove everything in two commands.</p>
<h2 id="up-auto">Automatic updates</h2>
<p>The setup turns on auto-update for the <code>cockpit</code> marketplace. Claude Code then refreshes the marketplace once per session and updates every Cockpit mod with a new version, each one on its own. The open session keeps the versions it loaded until you run <code>/reload-plugins</code>; the next session loads the new ones.</p>
<h2 id="up-manual">Update by hand</h2>
<p>Updating the bundle does not update the mods: each mod is its own plugin. To update them all now:</p>
{code(UPDATE_ALL)}
<p>To update one mod, name it: <code>claude plugin update hud@cockpit</code>.</p>
<h2 id="up-remove">Uninstall</h2>
{code('claude plugin uninstall cockpit@cockpit' + chr(10) + 'claude plugin prune')}
<p>Uninstalling the bundle leaves the mods installed; <code>claude plugin prune</code> removes them. The setup wrote <code>statusLine</code>, <code>spinnerTipsEnabled</code> and <code>autoCompactWindow</code> to your settings file and kept a backup next to it. Remove those keys by hand, or restore the backup.</p>
<h2 id="up-data">Remove the data</h2>
<p>The mods leave their diaries in <code>~/.local/state/mods/</code>. Delete that folder to remove everything Cockpit wrote.</p>'''

def versions():
    names = [m for _, _, ms in GROUPS for m in ms]
    rows = ''.join(f'<tr><td><a href="#mod-{m}"><code>{m}</code></a></td><td class="num">{meta(m)["version"]}</td><td class="num">{len(meta(m).get("userConfig", {}))}</td></tr>' for m in ['cockpit'] + names if m != 'cockpit')
    return f'''<p class="lead">Cockpit {meta("cockpit")["version"]}. The bundle carries the version of the release, and each mod carries the version of the release where it last changed.</p>
<p>A mod that did not change in a release keeps its version, so Claude Code does not update it. Versions before 1.0.0 are betas, such as <code>1.0.0-beta.2</code>.</p>
<table><thead><tr><th>Mod</th><th>Version</th><th>Options</th></tr></thead><tbody><tr><td><code>cockpit</code> (bundle)</td><td class="num">{meta("cockpit")["version"]}</td><td class="num">0</td></tr>{rows}</tbody></table>'''

PAGES = [
    ('Get started', [('intro', 'Introduction', intro), ('install', 'Installation', install), ('first-session', 'Your first session', first_session), ('update', 'Update and uninstall', update)]),
    ('Guides', [('panel-guide', 'The session panel', panel_guide), ('statusline', 'Status line styles', statusline_page), ('configuration', 'Configuration', configuration), ('server', 'Running on a server', server)]),
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
            chips = ''.join(f'<span class="tag">{c}</span>' for c in COMMANDS.get(m, [])) + (f'<span class="tag haiku">{MODEL_TAGS[m]}</span>' if m in MODEL_TAGS else '')
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
        src = f'<a class="src" href="https://github.com/{REPO}/blob/main/{pid[4:]}/README.md" target="_blank" rel="noopener">Edit this page on GitHub</a>' if fn is None else ''
        pages += f'<article class="page" id="p-{pid}" data-title="{html.escape(title)}" data-section="{section}" hidden><div class="crumb">{section}</div><h1>{title_html}</h1>{body}{src}{pager}</article>'
    tpl = open(os.path.join(HERE, 'shell.html')).read()
    out = tpl.replace('{{NAV}}', nav).replace('{{PAGES}}', pages)
    open(os.path.join(HERE, 'cockpit-docs.html'), 'w').write(out)
    print('pages', len(flat), 'bytes', len(out))

build()
