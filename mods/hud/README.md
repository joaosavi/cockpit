# hud

A heads-up display drawn by a mod in the band above the prompt. It shows the model, the project and
its git branch, the context window, the plan limits and the memory headroom. While a turn runs, it
adds the tool in flight, the running subagents and the turn's calls and errors. `/hud` opens the
full view in a pane.

The band works in the terminal and the Desktop app. Remote Control draws no band, so there `/hud`
answers with the same content as text.

A mod gets the session's data when the session starts, which in an interactive terminal happens at
the first prompt. Until then, the band shows only the call count. The context window and the plan
limits arrive with the model's first answer.

## What the band shows

The `panel` band, two rows. The right side of the first row sits flush with the last column:

```text
Opus 5.5 · my-app  main●                              38m · 214 calls
ctx ▰▰▰▰▱▱▱▱▱▱  42%   5h ▰▰▰▰▰▰▱▱▱▱  61% ↻19:30   7d ▰▰▰▰▱▱▱▱▱▱  44%   mem 1.9G free
```

While a turn runs, the activity block follows. It hides when the turn ends:

```text
● Bash  yarn turbo run test                                            0:42
  ├ Explore  map the routes                                            1:10
  └ general  research evals                                            3:02
  turn 4:12 · 37 calls · 2 errors · loop-breaker: repeated error
```

| Field | Source | Colors |
| :- | :- | :- |
| Model | `$.session.model()`: `claude-opus-5-5` reads `Opus 5.5`. An unknown id shows as given. | |
| Project and branch | The basename of the working directory, and `git status` in it. `●` marks uncommitted changes. Hidden outside a repo. | |
| `38m · 214 calls` | Time since the session started, and the tool calls it made | |
| `ctx` | Context window fill | green below 60%, yellow below 85%, red from 85% |
| `5h`, `7d` | The plan's 5-hour and 7-day windows. `↻19:30` is the reset time today, `↻Oct 11` a later day. | green below 75%, yellow below 90%, red from 90% |
| `mem` | Memory that still fits before the tightest cgroup limit, minus a 2% margin. Without a cgroup limit, the machine's available memory. Hidden when neither can be read. | yellow below 1 GB, red below 500 MB |
| Tool row | The main loop's running tool, its short input (command, file, pattern or description) and its elapsed time | |
| Subagent rows | Each running subagent from `$.agent.list()`, its description and the time since the band first saw it | |
| Turn row | Turn time, tool calls, errors, and the latest note another mod added to a tool result, such as a loop-breaker loop check or a memory-guard single-process rerun | errors red, the note yellow |

In a narrow terminal the band drops fields instead of wrapping. The panel first shortens its bars,
then drops `mem`, then shows `7d`, `5h` and `ctx` as percents only, then drops the reset time.
Free text, such as a long command, is cut with `…`. Figures are never cut.

## The /hud pane

```text
SESSION   Opus 5.5 · my-app  main● · 38m · 214 calls · ctx 42%
LIMITS    5h 61% ↻19:30 · 7d 44% ↻Oct 11
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
| `band` | `panel` | `panel` draws the two rows above. `line` draws one row. `off` leaves the band to the other mods, and `/hud` still works. |
| `activity` | `true` | Shows the activity block while a turn runs |
| `memory` | `true` | Shows the memory headroom in the band and the `MEMORY` row |
| `datasetDir` | `~/datasets/agent-ratings` | The rating mod's dataset folder, for the `RATINGS` row |
| `timeZone` | empty | The IANA time zone for reset times and for what counts as today, such as `America/New_York`. Empty uses the system time zone |

With `band` set to `line`:

```text
Opus 5.5 │ my-app  main● │ ctx 42% │ 5h 61% │ 7d 44% │ mem 1.9G
```

With `activity` set to `false`, the band keeps its rows during a turn and draws no tool or subagent
rows.

With `datasetDir` set to `~/data/ratings`, `/hud` reads `~/data/ratings/ratings/<day>.jsonl`.

## Cost

The band's render hook does no I/O. It lays out values that events and timers already read. The
work it causes:

- During a turn, a 1-second timer reads `$.agent.list()` and redraws, so the elapsed times move.
  The timer stops when the turn ends.
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
