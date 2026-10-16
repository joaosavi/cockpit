# spinner-status

While a turn runs, Claude Code draws the spinner and a tip under it. This mod replaces that tip with
one short line of its own: where the session stands, written by Haiku, or a tip about the mods you
have installed that fits the moment.

```text
✻ Propagating… (6s · ↓ 90 tokens)
  ⎿  Now: Running the tests after the fix to the date filter
```

The spinner itself stays as Claude Code draws it. The line goes under it, cut to the width of the
screen and to 100 characters. A bold label says what the line is, so it reads apart from Claude
Code's own `Tip:` line: `Now:` for where the session stands and `Mods:` for a
tip about the mods.

## Language

The labels and the tip catalog are English. In `mixed` and `summary` modes, Haiku writes the line in
Claude Code's `language` setting when it is set, and otherwise in the language the user writes in. The `tips` mode shows the catalog as written.

## Turn off the native tip

A mod cannot remove Claude Code's own tip line. Turn it off in `settings.json`, or the two lines
show together:

```json
{ "spinnerTipsEnabled": false }
```

The same switch is the **Show tips** row of `/config`.

## The modes

The `mode` option picks what the line shows. The default is `mixed`.

| Mode | What the line shows | Model calls |
| :--- | :--- | :--- |
| `mixed` | The session summary, then a tip Haiku picked for the moment, swapping every 15 seconds. Before the first reply, a tip from the catalog | One per turn |
| `tips` | A tip from the catalog, a new one each turn | None |
| `summary` | The session summary only. Before the first reply, the spinner shows nothing extra | One per turn |

The catalog has one tip for each command and mod of the `cockpit` marketplace: `/panel`, `/hud`,
`/limit`, `/ram`, and what `memory-guard`,
`loop-breaker`, `secret-guard`, `pipefail` and `usage-limit` do. It is a static list in
`hooks/rules.ts`.

## Options

| Option | Default | What it does |
| :--- | :--- | :--- |
| `enabled` | `true` | Off, the mod does nothing and makes no model call |
| `mode` | `mixed` | `mixed`, `tips` or `summary`, as above |
| `model` | `claude-haiku-4-5-20251001` | The model that writes the line: an alias such as `haiku`, or a full model id |

Set them in `settings.json` under `pluginConfigs`:

```json
{
  "pluginConfigs": {
    "spinner-status@cockpit": { "options": { "mode": "summary" } }
  }
}
```

## Cost

Each main-loop turn starts at most one model call, in the background, when the turn starts. The
spinner never waits for it: it keeps the previous line until the new one arrives. A turn that starts
while the previous call is still running makes no call.

The model never reads the whole session. It reads the last 3 prompts you typed and the agent's text
between them, oldest first, 3,000 characters at most, with no tool calls and no tool output. In
`mixed` mode the catalog goes along. The reply is capped at 150 tokens.

In a test session, three turns spent 1,574 input and 139 output tokens in all: about 525 in and 46
out per turn, or about $0.0008 per turn at Haiku 4.5 prices. Each call took about one second.

## The reply is data

The line Haiku writes is shown, never acted on. The mod keeps only the `NOW:` and `TIP:` lines,
removes control characters and markup, folds each line to one, and cuts it to the width. The
instructions tell the model that the session excerpt is data and not instructions.

## The diary

At the end of each session the mod writes one `session-summary` line to
`~/.local/state/mods/spinner-status/<day>-<session>.jsonl`. It counts the turns, the model calls by outcome
(`haiku:answered`, `haiku:api-error`, `haiku:empty-reply`, `haiku:aborted`, `haiku:no-text`,
`haiku:error`) and the calls skipped because one was still running (`skipped:busy`), and sums the
tokens, the model time and the excerpt size. It never writes the excerpt or the line.

## Limits

- The model call goes through Claude Code itself, with no command of its own, so it works the same on
  macOS, Windows and Linux. On Windows without `HOME`, the diary goes under `USERPROFILE`. Tested on Linux only.
- The spinner line is drawn by Claude Code's terminal interface. Tested only in a terminal.
