# panel

A local web page with a card for every Claude Code session on this machine: whether it waits for you, what it needs, what it is doing now, and what it finished. Each card's summary comes from `claude -p`, refreshed every few minutes and when you ask.

## Why

When several sessions run at once, you come back to each one without remembering where it stopped, and the only way to find out is to read it. Remote Control views on claude.ai and in the mobile app draw nothing a mod draws, so a status card inside the session would not show there. A page outside Claude Code reaches every session, wherever you drive it from.

## What it does

The page has three parts, and a second tab for the mods.

- **The strip at the top** shows the machine at a glance: the plan's 5-hour and weekly usage with the time left to each reset, the running sessions and how many need you, memory, CPU load, disk, and the tokens the sessions used in the last 24 hours, hour by hour. A bar turns amber at 75% and red at 90%.
- **The session deck** has one card per running session. A card shows the state (`Working`, `Waiting for you`, `Blocked`, `Done`, `Idle`), a title, the project, the git branch with its changed files and commits ahead or behind, the model, your last message, and the tool running now. Below that come the summary of where the task stands, the next step and what it finished. Four figures close the card: the context used against the point where it compacts, the tokens of the last 24 hours, the memory of the session's processes, and how long it has run. The sessions that need you come first, and the filters above the deck narrow them.
- **The side column** shows the machine: the memory of each cgroup the sessions run in, the state of their systemd services, the latest actions of the Cockpit guards, what each guard did today, and how many summaries the page made.

The **Mods** tab audits the mods, read from their diaries over the last day, 7 days or 30 days. Each row shows the mod's version, whether it is on, how many sessions it ran in, what it did, its failures in red, the time its hooks added per tool call, its slowest hook call, and its last action. Click a row to list its recent actions with their details.

## Where the figures come from

Every figure is read on the machine, so the page works the same on any setup and leaves out what a machine does not have.

| Part | Source | When it is missing |
| :- | :- | :- |
| Plan usage | The `usage-limit` mod's last reading, shared by every session | The two plan figures are left out |
| Sessions | `~/.claude/sessions/` and each session's transcript | |
| Memory by group | cgroup v2: each session's cgroup and the parents that set `memory.max` or `memory.high` | Linux without cgroup v2, macOS, or sessions in unlimited cgroups: only the machine's memory shows |
| Services | `systemctl show` for the `.service` cgroups above | Without systemd the box is left out |
| Processes | `/proc`, or `ps` on macOS | |
| Git | `git status` in each session's folder, every 30 seconds | A folder outside git shows no branch |
| Guards | The Cockpit mods' diaries in `~/.local/state/mods/` | A mod that is not installed is left out |
| Sending | The tmux pane whose process is the session or one of its parents, on any tmux socket of the user | A session outside tmux has no send buttons |

To answer a session from the page:

- When a session waits for a decision, its options are buttons. Press one, confirm, and the page types the option into the session's prompt and presses Enter, as if you typed it.
- The **Reply** field under each card sends any text the same way.
- Sending works for a session that runs in tmux. The page asks before every send.

Other details:

- The server writes a summary when you press **Refresh**, 20 seconds after a session goes idle at the end of a turn, and every `refreshMinutes` for a session whose transcript changed. Summaries run one at a time.
- A card links to the session on claude.ai when the session runs with Remote Control. The **tmux** button copies the command that attaches to its pane.
- The browser tab shows how many sessions need you. **Notify** turns on a browser notification when a session starts waiting for you or gets blocked. `r` refreshes every session.
- The page asks the server for new data every 4 seconds. An ended session stays under the **Ended** filter for 12 hours.

## How the summary is made

The server builds a digest of the transcript, at most 48,000 characters long. The digest holds the message that opened the task, then the newest rows that fit. Each tool call is cut to one line, and a compaction summary stays in place of the rows it replaced.

The server sends the digest to `claude -p --safe-mode --tools "" --no-session-persistence` with a JSON schema. The call loads no hooks, plugins or tools, keeps no transcript of its own, and answers in a fixed shape. The model writes in the language you write in.

## Commands

- `/panel` says where the page is, the SSH tunnel command, and how many sessions need you. Plain text, so it reads the same in Remote Control.

## Reach it from another computer

The server listens on `127.0.0.1` only. On your computer, open a tunnel:

```sh
ssh -N -L 7777:127.0.0.1:7777 <host>
```

Then open `http://localhost:7777`.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `port` | `7777` | The port the page listens on, on `127.0.0.1`. |
| `model` | `sonnet` | The model `claude -p` uses for each summary: `sonnet`, `haiku` or `opus`. |
| `refreshMinutes` | `5` | A session whose transcript changed gets a new summary this often. |
| `autostart` | `true` | Start the server when a session starts and the port does not answer. Turn it off when a service manager runs the server. |

## Run it as a service

With `autostart` on, the first session starts the server, and the server keeps running after that session ends. To run it under systemd instead, set `autostart` to `false` and run `python3 -I <plugin folder>/server/panel.py`. These variables set the server's options: `PANEL_PORT`, `PANEL_MODEL` and `PANEL_REFRESH_MINUTES`. Set `PANEL_CLAUDE` to the path of `claude` when it is not on the service's `PATH`. Set `PANEL_GROUPS` to a comma-separated list of cgroup paths, such as `agents.slice`, to show those groups and everything under them instead of the ones the page finds.

## What it records

- `~/.local/state/mods/panel/summaries/<session>.json`: the last summary of each session, with the time it was made and the transcript size it read.
- `~/.local/state/mods/panel/<day>-server.jsonl`: one line per summary with the reason, the time, the state and the tokens, one line per failure, and one line per sent answer with its length. It never writes the session's content or what you sent.

## Cost

Each summary is one `claude -p` call, and it counts toward your plan's usage limits. On the author's VPS in October 2026, a summary of a long session read about 48,000 tokens and took 6 to 10 seconds. The server's memory peaked at 213 MB during the call.

## Limits

- The sessions must run on the same machine, under the same user as the server.
- On macOS the page has no memory groups or services, because macOS has neither cgroups nor systemd.
- The page has no login. Anyone who can connect to the port on that machine can read it, start summaries and type into the sessions, so keep it on `127.0.0.1`. The server refuses a request that comes from a page on another site.
- Sending types into the tmux pane. If you are typing in that pane at the same moment, the two texts mix.
- A session's claude.ai link exists only when the session runs with Remote Control.
- The state comes from the model and can lag behind the session. A busy session always shows `Working`, whatever the last summary said.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install panel@cockpit
```

The `cockpit` bundle installs it with the other mods. The machine needs Python 3.9 or later and `curl`.
