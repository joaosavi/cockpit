# hud

A heads-up display. It shows the model, the project and its git branch, the context window, the
plan limits and the memory headroom, under the prompt as a status line or above it in the band. While
a turn runs, the band adds what Claude Code's own screen leaves out: the turn's errors and the latest
note another mod added to a tool result.
`/hud` opens the full view in a pane.

## The status line

A mod cannot draw rows under the prompt: that place belongs to the status line command of the
settings. The mod ships one, `statusline/statusline.sh`, which draws the two `panel` rows there.
Set it in `~/.claude/settings.json`, and set `band` to `off` so the rows do not show twice:

```json
{
  "statusLine": { "type": "command", "command": "~/claude-devcontainer/mods/hud/statusline/statusline.sh" },
  "pluginConfigs": { "hud@agent": { "options": { "band": "off" } } }
}
```

The path above is a clone of the repo. When the marketplace was added from GitHub, Claude Code keeps
its own clone at `~/.claude/plugins/marketplaces/agent`, and `claude plugin marketplace update agent`
keeps it current, so `~/.claude/plugins/marketplaces/agent/mods/hud/statusline/statusline.sh` works
too. The `installPath` of the mod changes with each version, so avoid it. The script needs Node 22.18 or later, which runs its
TypeScript as is.

The status line reads the model, the folder, the context window and the plan limits from the JSON
Claude Code pipes to it, so they show from the session's first screen, before any prompt. It reads
git and the cgroup memory itself. The tool call count comes from the mod, which writes it at each
call to `~/.local/state/mods/hud/live/<session>.json` and removes the file when the session ends.
Without the file, the row shows `0 calls`.

With `band` set to `off`, the band still draws the activity row while a turn runs, unless
`activity` is `false`.

The band works in the terminal and the Desktop app. Remote Control draws no band, so there `/hud`
answers with the same content as text.

A mod gets the session's data when the session starts, which in an interactive terminal happens at
the first prompt. Until then, the band shows only the call count. The context window and the plan
limits arrive with the model's first answer.

## What the band shows

The `panel` band, two rows. The right side of the first row sits flush with the last column:

```text
Opus 5.5 · my-app  main●                              38m · 214 calls
ctx ▰▰▰▰▱▱▱▱▱▱  42%   5h ▰▰▰▰▰▰▱▱▱▱  61% resets 2h30m   7d ▰▰▰▰▱▱▱▱▱▱  44%   mem 1.9G free
```

While a turn runs and something went wrong, the activity row follows. It hides when the turn ends,
and it does not show while the turn has no error and no note:

```text
2 errors · loop-breaker: repeated error
```

Claude Code already draws the running tool, its time, the subagents and the turn's time, so the band
leaves them out. `/hud` still lists the tool and the subagents in its `NOW` row.

| Field | Source | Colors |
| :- | :- | :- |
| Model | `$.session.model()`: `claude-opus-5-5` reads `Opus 5.5`. An unknown id shows as given. | |
| Project and branch | The basename of the working directory, and `git status` in it. `●` marks uncommitted changes. Hidden outside a repo. | |
| `38m · 214 calls` | Time since the session started, and the tool calls it made | |
| `ctx` | Context window fill | green below 60%, yellow below 85%, red from 85% |
| `5h`, `7d` | The plan's 5-hour and 7-day windows. `resets 2h30m` is the time left until the window resets, `resets 3d20h` past a day. | green below 75%, yellow below 90%, red from 90% |
| `mem` | Memory that still fits before the tightest cgroup limit, minus a 2% margin. Without a cgroup limit, the machine's available memory. Hidden when neither can be read. | yellow below 1 GB, red below 500 MB |
| Activity row | The turn's errors, and the latest note another mod added to a tool result, such as a loop-breaker loop check or a memory-guard single-process rerun | errors red, the note yellow |

In a narrow terminal the band drops fields instead of wrapping. The panel first shortens its bars,
then drops `mem`, then shows `7d`, `5h` and `ctx` as percents only, then drops the reset countdown.
Free text, such as a long command, is cut with `…`. Figures are never cut.

## The /hud pane

```text
SESSION   Opus 5.5 · my-app  main● · 38m · 214 calls · ctx 42%
LIMITS    5h 61% resets 2h30m · 7d 44% resets 3d20h
MEMORY    session 1.5G · slice 3.0/5.0G · 1.9G fits
NOW       Bash yarn turbo run test 0:42 · 2 subagents
TODAY     2 skills · 1 loop nudge · 14 MCP writes · 0 refusals
RATINGS   last 4/5 · today 3.8 (12 rated)
```

- `MEMORY` names the session's own cgroup and the group whose limit sets the headroom.
- `TODAY` counts today's lines in the other mods' diaries under `~/.local/state/mods`: skill-loader
  `loaded`, loop-breaker `nudge`, audit lines with an `action`, usage-limit `tool-refused` and
  memory-guard `refused`.
- `RATINGS` reads `ratings/<day>.jsonl` in the rating mod's dataset. The row hides when the folder
  is missing.

The pane refreshes every 2 seconds while it is open. Press `r` to refresh now and Esc to close it.

## Options

Set the options in `/config`, or under `pluginConfigs` in `~/.claude/settings.json`.

| Option | Default | What it does |
| :- | :- | :- |
| `band` | `panel` | `panel` draws the two rows above. `line` draws one row. `off` leaves the band to the other mods and to the activity row, and `/hud` still works. Use `off` with the status line. |
| `activity` | `true` | Shows the activity row while a turn runs |
| `memory` | `true` | Shows the memory headroom in the band and the `MEMORY` row |
| `datasetDir` | `~/datasets/agent-ratings` | The rating mod's dataset folder, for the `RATINGS` row |
| `bar` | `blocks` | The bar glyphs: `blocks` (`▰▱`), `solid` (`█░`), `line` (`━─`), `dots` (`●○`) or `squares` (`■□`) |
| `barWidth` | `10` | Cells of a full-width bar, 4 to 30. A narrow terminal still shrinks the bars |
| `colors` | empty | The colors for ok, warning and critical, separated by spaces. Each one is a name (`green`, `bright-cyan`), `#rrggbb` or a 256-color number. Empty uses green, yellow and red |
| `hide` | empty | Fields to leave out, separated by commas: `model`, `project`, `branch`, `age`, `calls`, `ctx`, `5h`, `7d`, `reset`, `mem` |
| `contextBase` | `compact` | What `ctx` measures against. With `compact`, 100% is the auto-compact window that `/autocompact` or `CLAUDE_CODE_AUTO_COMPACT_WINDOW` sets, when it is smaller than the model's window. With `window`, the model's full window. The status line only. The band and `/hud` read the model's window |
| `timeZone` | empty | The IANA time zone for what counts as today, such as `America/New_York`. Empty uses the system time zone |

With `bar` set to `solid`, `colors` set to `cyan #ff8800 bright-red` and `hide` set to `branch, mem`:

```text
Opus 5.5 · my-app                                                    38m · 214 calls
ctx ████░░░░░░  42%   5h ██████░░░░  61% resets 2h30m   7d ████░░░░░░  44%
```

With `band` set to `line`:

```text
Opus 5.5 │ my-app  main● │ ctx 42% │ 5h 61% │ 7d 44% │ mem 1.9G
```

With `activity` set to `false`, the band draws no activity row.

With `datasetDir` set to `~/data/ratings`, `/hud` reads `~/data/ratings/ratings/<day>.jsonl`.

## Cost

The band's render hook does no I/O. It lays out values that events and timers already read. The
work it causes:

- During a turn, a 1-second timer reads `$.agent.list()` for `/hud`, and redraws only while the
  pane is open. The timer stops when the turn ends.
- Every 15 seconds, idle or not, one `git status` (3-second timeout) and a read of the cgroup files
  under `/sys/fs/cgroup`. The band redraws only when what it shows changed.
- Each tool call adds two redraw requests, one at its start and one at its end. Claude Code throttles
  redraws to 10 a second and merges the rest.
- `/hud` reads today's diaries and the newest two rating files. While the pane is open, it lists the
  folders every 2 seconds and reads a file again only when its size changed.

At the end of each session the mod writes one summary line to
`~/.local/state/mods/hud/<day>-<session>.jsonl`: tool calls seen, the hook's own time per call, the
number of band renders and the slowest one. `/mods` from the mod-report mod reads that line.

## Develop

```sh
claude plugin validate .
claude plugin test
tsc -p .
```
