# loop-breaker

Notices when the agent goes in circles and tells it to stop and change approach.

## Why

An agent that keeps editing the same file after the same failure burns tokens and time without getting closer. A short nudge at the right moment makes it step back, which a rule in `CLAUDE.md` does not do reliably.

## What it does

The mod counts three signals per agent loop (the main conversation and each subagent), reset at the end of each turn:

- Fix attempts: edits to one file while a command that failed has not passed again.
- Repeated errors: the same error coming back, with numbers, paths and quoted values ignored.
- Repeated calls: the same tool with the same arguments, in a row.

When a count reaches its limit, the mod adds a note to the tool result. The note starts with `Loop check` and asks the agent to write what it tried, then re-read the code, form a new hypothesis, or ask you. Nothing is refused.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `enabled` | `true` | Off, the mod does nothing: no count, no nudge. Takes effect in the next session, or after `/reload-plugins`. |
| `editLimit` | `5` | Fix attempts on one file in one turn before the nudge. |
| `errorLimit` | `3` | Times the same error may come back in one turn before the nudge. |
| `repeatLimit` | `3` | Identical tool calls in a row before the nudge. |
| `editCheck` | `true` | Nudge after `editLimit` fix attempts on one file. |
| `errorCheck` | `true` | Nudge after the same error comes back `errorLimit` times. |
| `repeatCheck` | `true` | Nudge after `repeatLimit` identical calls in a row. |

## What it records

`~/.local/state/mods/loop-breaker/<day>-<session>.jsonl`: one line per nudge with its kind and count, plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

The hook added about 2 ms per tool call on the author's Linux machine (60 calls measured in October 2026, an estimate).

## Limits

- A failure is read from the exit code and from failure words in the output, so a tool that fails silently is not counted.
- Counts reset at the end of each turn, so a loop that spans several turns is not caught.
- On Windows without `HOME`, the diary goes under `USERPROFILE`. Tested on Linux only.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install loop-breaker@cockpit
```

The `cockpit` bundle installs it with the other mods.
