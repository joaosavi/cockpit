# mod-report

`/mods [days]` reports what each mod did and what it cost, so you can tell which mods help and which get in the way.

## Why

Each mod writes a diary, but reading ten folders of JSONL files is not something you do on a busy day. This mod reads them for you.

## What it does

- Reads every diary under `~/.local/state/mods` in the window, one folder per mod.
- For each mod, adds up the sessions, tool calls, actions, and the time its `tool.call` hook spent per call, with the largest single call.
- Lists what needs attention: a mod above 20 ms per tool call, refused commands, held writes, loop nudges and pauses.

## Commands

- `/mods [days]` reports the last 7 days, or the number of days you give, up to 365. Plain text, so it reads the same in Remote Control. In a terminal it also opens the Mods pane, with the flags in the warning color. Press `esc` to close.

## Options

None.

## What it records

Nothing. It only reads the other mods' diaries.

## Cost

None per tool call: the mod has no `tool.call` hook. `/mods` reads every diary in the window once.

## Limits

- A session still open has no summary line yet, and shows as "still open".
- The figures are as good as the diaries. A mod that does not write a `session-summary` line is not counted.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install mod-report@cockpit
```

The `cockpit` bundle installs it with the other mods.
