# Cockpit

Mods for Claude Code. The guards keep the agent out of trouble: secrets in tool output, a pipe that hides a failed test, a memory limit that kills the build, a second session's edits swept into your commit. The instruments show where the session stands: a status line under the prompt, a one-line summary under the spinner, and a local web page with a card for every session on the machine.

Each mod is a Claude Code plugin with TypeScript hooks and its own tests. The `cockpit` plugin installs all eleven at once.

## Requirements

- Claude Code 2.1.287 or later, on macOS, Windows or Linux. Mods use Claude Code's function hooks, which are in early access and may change between releases.
- Node 22.18 or later, for the status line script.
- Python 3.9 or later and `curl`, for the `panel` page. macOS and Windows 10 or later ship `curl`. On Windows, install Python from python.org or the Microsoft Store.
- A [Nerd Font](https://www.nerdfonts.com/) in your terminal, for the status line icons. Without one, choose the plain icons during setup.

The status line, the spinner line and the panes are part of Claude Code's terminal interface. Run `claude` in a terminal: Terminal or iTerm on macOS, Windows Terminal or PowerShell on Windows, or the terminal panel of VS Code or JetBrains. The mods are tested only in the terminal interface, not in the Desktop app or in the chat panel of the IDE extensions.

## What changes per system

Every mod runs on macOS, Windows and Linux. They are tested on Linux only. Two things differ:

- `memory-guard` and the memory figure of the `hud` read cgroup limits and `/proc/meminfo` on Linux. On macOS they read `vm_stat` and on Windows PowerShell, and there they compare against the whole machine's memory. The macOS and Windows readings are tested only against simulated output.
- The `panel` page shows memory by cgroup, systemd services and the share of CPU time spent waiting on disk only on Linux.

The Limits section of each mod's README says what changes on each system.

## Install

1. Add the marketplace and install the bundle:

	```sh
	claude plugin marketplace add joaosavi/cockpit
	claude plugin install cockpit@cockpit
	```

2. Restart Claude Code.
3. Run `/cockpit:setup`. It asks four questions, with previews, and writes what a plugin cannot set by itself: the status line, the spinner tip, and when to compact. It shows the result and tells you what changed.

The setup turns on auto-update for `cockpit`, so new versions install by themselves a few minutes after the first message of a session.

## The mods

### Guards

| Mod | What it does |
| :- | :- |
| `secret-guard` | Replaces every secret value in tool output with `<hidden:NAME>` before the agent reads it, and writes the real value back when the agent edits a `.env` file. |
| `collision-guard` | Warns when another session on this machine edited the same file, and holds a git command once when it would stage, commit, stash or discard that session's uncommitted edits. |
| `pipefail` | Adds `set -o pipefail;` to a test, typecheck or lint run piped into `tail`, `head` or `grep`, so a failed run cannot exit 0. |
| `memory-guard` | Keeps typecheck, build, test and Playwright runs under the memory limit: it runs them with one process, waits, or refuses. It reruns a command killed with exit 137 with one process. |
| `loop-breaker` | Tells the agent to stop and change approach when it repeats the same error, the same fix or the same call. |
| `usage-limit` | Limits each plan window on its own: one subagent at a time (5-hour 90%, 7-day 97%), a work-in-progress commit (97%, 98%), a pause (98%, 99%), each switchable, and a resume when the window resets. |

### Instruments

| Mod | What it does |
| :- | :- |
| `hud` | Model, project, git branch and PR, context window, plan limits and memory, in a status line under the prompt. Four styles. |
| `spinner-status` | Replaces the tip under the spinner with one line from Haiku: where the session stands, or a tip about these mods. |
| `panel` | A local web page with a card for every Claude Code session on this machine: its state, what it needs from you, the tool running now, what was done and the next step. `/panel` gives the address. |
| `skill-loader` | Delivers the right skill when the agent touches a matching file or writes a commit, and reminds it to diagnose before fixing when you paste an error. |

### Memory

| Mod | What it does |
| :- | :- |
| `global-memory` | Adds a machine-wide memory folder beside the per-project memory, so facts about the machine reach every session. It starts once you create `~/.claude/global-memory/MEMORY.md`. |

On a Team or Enterprise plan, `global-memory` installs but does nothing until your organization lists it in managed settings: the plan's built-in guard skips plugins you install yourself on the hooks it needs. Its README shows the two settings to add.

To turn one mod off, set its **Enabled** option to off in `/config`, or `"enabled": false` under its `pluginConfigs` entry, and start a new session or run `/reload-plugins`. The guards also have one switch per step, such as the wait and the refusal of `memory-guard` or each signal of `loop-breaker`; each mod's README lists them. To remove a mod's hooks entirely, disable the bundle first and then the mod, because Claude Code refuses to disable a plugin that an enabled plugin requires: `claude plugin disable cockpit@cockpit && claude plugin disable pipefail@cockpit`.

## Commands

| Command | What it shows |
| :- | :- |
| `/panel` | The address of the session page, and how many sessions need you. |
| `/hud` | The full heads-up display in a pane. |
| `/limit` | The 5-hour and 7-day usage limits, and what the mod holds back. |
| `/ram` | Memory headroom per group, or of the machine, and the measured peak of each heavy command. |
| `/cockpit:setup` | Runs the setup again, to change the style or any other choice. |

## Configure

Each mod's options are rows in `/config`. Each mod's README lists its options, what it records, and what it costs.

## What leaves your machine

`panel` and `spinner-status` send an excerpt of the session to a model through your own Claude account. `panel` runs `claude -p` (`sonnet` by default) on each session's transcript when you press Refresh, when a session goes idle after a turn, and every 5 minutes for a session that changed. `spinner-status` sends the last few prompts and the agent's last text to Haiku, at most 3,000 characters, one call per turn in its default mode and none in `tips` mode. No other mod calls a model. The `hud` status line runs `gh pr view` to show the branch's pull request, so it reaches GitHub when `gh` is installed.

## What stays on your machine

- Every mod writes a diary under `~/.local/state/mods/<mod>/`, one line per action and one summary per session. A diary never holds a secret value or a file's content.

## Running on a server

Some people run Claude Code on a remote Linux machine over SSH. The mods work the same there, and a few parts do more:

- `panel` listens on `127.0.0.1` only. From your own computer, open an SSH tunnel, `ssh -N -L 7777:127.0.0.1:7777 <host>`, then open `http://localhost:7777`. In a session opened over SSH, `/panel` prints this command with the machine's name.
- `memory-guard` reads the cgroup v2 memory limits, such as the ones a systemd service sets, and the panel shows each group's memory and the state of its systemd services.
- Every command answers in plain text, so it also works when you drive the session over Remote Control from claude.ai or the mobile app.

## Uninstall

```sh
claude plugin uninstall cockpit@cockpit
claude plugin prune
```

Uninstalling the bundle leaves the mods installed. `claude plugin prune` removes them. The setup wrote `statusLine`, `spinnerTipsEnabled` and `autoCompactWindow` to your settings file, and kept a backup of the file it changed. Remove those keys by hand, or restore the backup.

## License

MIT. `skill-loader` ships skills by Matt Pocock under the MIT license. See `skill-loader/skills/NOTICE.md`.
