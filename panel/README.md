# panel

A local web page with a card for every Claude Code session on your computer: whether it waits for you, what it needs, what it is doing now, and what it finished. Each card's summary comes from `claude -p`, refreshed every few minutes and when you ask.

## Why

When several sessions run at once, you come back to each one without remembering where it stopped, and the only way to find out is to read it. The page puts them side by side in a browser tab, so you see which one needs you before you switch windows.

## What it does

Type `/panel` in any session for the address, `http://localhost:7777` by default, and open it in your browser. The page has three parts, and a second tab for the mods.

- **The strip at the top** shows the computer at a glance: the plan's 5-hour and weekly usage with the time left to each reset, the running sessions and how many need you, memory, the CPU over the last minute, disk, and the tokens the sessions used in the last 24 hours, hour by hour. A bar turns amber at 75% and red at 90%.
- **The session deck** has one card per running session. A card shows the state (`Working`, `Waiting for you`, `Blocked`, `Done`, `Idle`), a title, the project, the git branch with its changed files and commits ahead or behind, the model, your last message, and the tool running now. Below that come the summary of where the task stands, the next step and what it finished. Four figures close the card: the context used against the point where it compacts, the tokens of the last 24 hours, the memory of the session's processes, and how long it has run. The sessions that need you come first, and the filters above the deck narrow them.
- **The side column** shows the latest actions of the Cockpit guards, what each guard did today, and how many summaries the page made today with their tokens and their price at API list prices. On Linux it also shows the memory of each cgroup with a limit that the sessions run in, and the state of their systemd services.

The **Mods** tab audits the mods, read from their diaries over the last day, 7 days or 30 days. Each row shows the mod's version, whether it is on, how many sessions it ran in, what it did, its failures in red, the time its hooks added per tool call, its slowest hook call, the API cost of its model calls, and its last action. Click a row to list its recent actions with their details.

## Where the figures come from

Every figure is read on your computer. A figure the system cannot give is left out.

| Part | Source | When it is missing |
| :- | :- | :- |
| Plan usage | The `usage-limit` mod's last reading, shared by every session | The two plan figures are left out |
| Sessions | `~/.claude/sessions/` and each session's transcript | |
| Memory | The machine's total and available memory: `/proc/meminfo` on Linux, `sysctl` and `vm_stat` on macOS, `GlobalMemoryStatusEx` on Windows | |
| Memory by group | Linux with cgroup v2: each session's cgroup and the parents that set `memory.max` or `memory.high` | macOS, Windows, Linux without cgroup v2, or sessions in unlimited cgroups: only the machine's memory shows |
| CPU, last minute | The share of CPU time that was not idle over the last minute, across all cores. The share spent waiting on disk shows apart, under the figure, when it reaches 5%. Linux reads the tick counters in `/proc/stat` and Windows those of `GetSystemTimes`. macOS has no counter a script can read, so the page sums the `%cpu` of every process from `ps` and divides it by the cores | macOS and Windows show no disk wait |
| Services | `systemctl show` for the `.service` cgroups above | Without systemd the box is left out |
| Processes | `/proc` on Linux, `ps` on macOS, a PowerShell query on Windows | |
| Git | `git status` in each session's folder, every 30 seconds | A folder outside git shows no branch |
| Guards | The Cockpit mods' diaries in `~/.local/state/mods/` | A mod that is not installed is left out |
| Sending | The session's inbox, `~/.local/state/mods/panel/inbox/<session>.json`, which the `panel` mod in that session checks every 2 seconds | A session whose mod has not checked its inbox in the last 15 seconds shows no send buttons |
| API cost | `claude -p`'s own price for each summary, and the token counts other mods write to their diaries, priced at Anthropic's API list prices | A mod that calls no model costs nothing |

The API cost is what the same calls would cost through the API. On a Pro or Max plan the calls spend plan usage, not money.

## Answer a session from the page

- When a session waits for a decision, its options are buttons. Press one, check the text, and confirm. The **Reply** field under each card sends any text the same way.
- The page leaves the text in the session's inbox. The `panel` mod in that session checks the inbox every 2 seconds and submits the text as your prompt, and Claude Code runs it once the session is idle. The transcript shows it as a prompt from the panel plugin.
- This works on macOS, Windows and Linux, in a terminal, the Desktop app, an IDE or Remote Control, with or without tmux.
- The page waits up to 6 seconds for the mod to take the message. When the mod does not, the page withdraws it and says so.
- A card shows send buttons only when its session's mod checked the inbox in the last 15 seconds. A session that loaded an older `panel` mod has none until you run `/reload-plugins` in it.

## Other details

- The server writes a summary when you press **Refresh**, 20 seconds after a session goes idle at the end of a turn, and every `refreshMinutes` for a session whose transcript changed. Summaries run one at a time.
- The browser tab shows how many sessions need you. **Notify** turns on a browser notification when a session starts waiting for you or gets blocked. `r` refreshes every session.
- The page asks the server for new data every 4 seconds. An ended session stays under the **Ended** filter for 12 hours.
- A card links to the session on claude.ai when the session runs with Remote Control. For a session that runs in tmux, the **tmux** button copies the command that attaches to its pane.

## How the summary is made

The server builds a digest of the transcript, at most 48,000 characters long. The digest holds the message that opened the task, then the newest rows that fit. Each tool call is cut to one line, and a compaction summary stays in place of the rows it replaced.

The server sends the digest to `claude -p --safe-mode --tools "" --no-session-persistence` with a JSON schema. The call loads no hooks, plugins or tools, keeps no transcript of its own, and answers in a fixed shape. The model writes in the language you write in.

## Commands

- `/panel` says where the page is and how many sessions need you, and starts the server when it does not answer. In a session opened over SSH, it also prints the tunnel command that reaches the page from your computer.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `port` | `7777` | The port the page listens on, on `127.0.0.1`. |
| `model` | `sonnet` | The model `claude -p` uses for each summary: `sonnet`, `haiku` or `opus`. |
| `refreshMinutes` | `5` | A session whose transcript changed gets a new summary this often. |
| `autostart` | `true` | Start the server when a session starts and the port does not answer. Turn it off when a service manager runs the server. |

## Start the server by hand

With `autostart` on, the first session starts the server, and the server keeps running after that session ends. To start it yourself, run the server file from the plugin folder, which is the `installPath` of `panel@cockpit` in `~/.claude/plugins/installed_plugins.json`:

```sh
python3 -I <plugin folder>/server/panel.py
```

On Windows, use `python` or `py` in place of `python3`. These variables set the server's options: `PANEL_PORT`, `PANEL_MODEL` and `PANEL_REFRESH_MINUTES`. Set `PANEL_CLAUDE` to the path of `claude` when it is not on the `PATH`.

## Running on a server

When Claude Code runs on a remote machine over SSH, the page is still there, on that machine.

- The server listens on `127.0.0.1` only. From your computer, open a tunnel, then open `http://localhost:7777`:

	```sh
	ssh -N -L 7777:127.0.0.1:7777 <host>
	```

- To run the server under systemd instead of a session, set `autostart` to `false` and run the command above as a unit. Set `PANEL_GROUPS` to a comma-separated list of cgroup paths, such as `agents.slice`, to show those groups and everything under them instead of the ones the page finds.

## What it records

- `~/.local/state/mods/panel/summaries/<session>.json`: the last summary of each session, with the time it was made and the transcript size it read.
- `~/.local/state/mods/panel/<day>-server.jsonl`: one line per summary with the reason, the time, the state and the tokens, one line per failure, and one line per sent answer with its length. It never writes the session's content or what you sent.

## Cost

Each summary is one `claude -p` call, and it counts toward your plan's usage limits. On the author's Linux machine in October 2026, a summary of a long session read about 48,000 tokens and took 6 to 10 seconds, and the server's memory peaked at 213 MB during the call. At API list prices with `sonnet`, a summary cost about $0.07, and with four sessions working the page spent up to $2.40 an hour. The **API cost** column of the Mods tab shows the figure for your machine. `haiku` costs about 20 times less per token, with shorter and less exact summaries.

## Limits

- The sessions must run on the same machine, under the same user as the server.
- The page runs on Linux, macOS and Windows. It was tested on Linux; the macOS and Windows code paths run only through tests that simulate them.
- On macOS and Windows the page has no memory groups, no services and no disk wait, because those systems have no cgroups, no systemd and no I/O wait counter the page reads.
- On Windows without `HOME`, the mod uses `USERPROFILE` for `~`, as the server does.
- The macOS CPU figure sums each process's recent `%cpu` from `ps`, which is a decaying average, so it moves more slowly than the Linux and Windows figures.
- The page has no login. Anyone who can connect to the port on that machine can read it, start summaries and type into the sessions, so keep it on `127.0.0.1`. The server refuses a request that comes from a page on another site.
- An answer sent from the page waits until the session is idle. While a turn runs, it does not reach the agent, and it runs as a new turn after the current one ends.
- The state comes from the model and can lag behind the session. A busy session always shows `Working`, whatever the last summary said.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install panel@cockpit
```

The `cockpit` bundle installs it with the other mods. The machine needs Python 3.9 or later, as `python3`, `python` or `py`, and `curl`. macOS and Windows 10 or later ship `curl`. On Windows, install Python from python.org or the Microsoft Store.
