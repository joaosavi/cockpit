# cockpit

Installs every Cockpit mod at once. Each mod is a dependency of this bundle, so one install brings them all.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install cockpit@cockpit
```

## The mods

- `usage-limit`: per window, one subagent at a time (5-hour 90%, 7-day 97%), a work-in-progress commit (97%, 98%), a pause (98%, 99%), each switchable, and an automatic resume when the window resets. `/limit`.
- `memory-guard`: keeps typecheck, build, test and Playwright runs under the memory limit, with one process, a wait, or a refusal, and reruns a command killed with exit 137 with one process. `/ram`.
- `skill-loader`: delivers the right skill when the agent touches a file or commits, and reminds it to load diagnosing-bugs when you paste an error.
- `loop-breaker`: tells the agent to stop and change approach when it goes in circles.
- `secret-guard`: hides every secret value in tool output as `<hidden:NAME>`, and writes the real value back into `.env` files.
- `collision-guard`: warns when another session on this machine edited the same file, and holds a git command once when it would take that session's uncommitted edits along.
- `pipefail`: adds `set -o pipefail;` to a test, typecheck or lint run piped into `tail`, `head` or `grep`.
- `panel`: a local web page with a card for every session on this machine, with what it needs from you and what it is doing. `/panel` gives the address.
- `global-memory`: a machine-wide memory folder beside the per-project auto memory. It starts once you create `~/.claude/global-memory/MEMORY.md`.
- `spinner-status`: replaces the tip under the spinner with one Haiku line: where the session stands, or a tip about these mods. Needs `"spinnerTipsEnabled": false` in settings.

Each mod has its own README with its options, what it records, what it costs, and what changes on macOS, Windows and Linux.

## Team and Enterprise plans

On a Team or Enterprise plan, `global-memory` installs but does nothing until your organization lists it in managed settings: the plan's built-in guard skips plugins you install yourself on the hooks it needs. Its README shows the two settings to add.

## Turn one mod off

To turn one mod off, set its **Enabled** option to off in `/config`, or `"enabled": false` under its `pluginConfigs` entry, and start a new session or run `/reload-plugins`. The guards also have one switch per step, such as the wait and the refusal of `memory-guard` or each signal of `loop-breaker`; each mod's README lists them. To remove a mod's hooks entirely, disable the bundle first and then the mod, because Claude Code refuses to disable a plugin that an enabled plugin requires: `claude plugin disable cockpit@cockpit && claude plugin disable pipefail@cockpit`.

## Where the mods write

Every mod writes its diary under `~/.local/state/mods/<mod>/`, where `~` is `HOME`, or `USERPROFILE` on Windows when `HOME` is unset. Each diary line has `at`, `session` and `event`, and each session ends with one `session-summary` line with the calls it saw, its actions and the time its hooks took.
