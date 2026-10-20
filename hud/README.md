# hud

A heads-up display. It shows the model, the project and its git branch, the context window, the
plan limits and the memory headroom, under the prompt as a status line or above it in the band. While
a turn runs, the band adds what Claude Code's own screen leaves out: the latest note another mod
added to a tool result, which only the model reads otherwise.
`/hud` opens the full view in a pane.

## The status line

A mod cannot draw rows under the prompt: that place belongs to the status line command of the
settings. The mod ships one, `statusline/statusline.sh`, which draws the hud there in one of four
styles. `/cockpit:setup` writes it for you. To set it by hand, on macOS or Linux, put this in
`~/.claude/settings.json`, and set `band` to `off` so the rows do not show twice:

```json
{
  "statusLine": { "type": "command", "command": "~/.claude/plugins/marketplaces/cockpit/hud/statusline/statusline.sh", "refreshInterval": 5 },
  "pluginConfigs": { "hud@cockpit": { "options": { "band": "off", "style": "refined", "icons": "nerd" } } }
}
```

When the marketplace was added from GitHub, Claude Code keeps its own clone at
`~/.claude/plugins/marketplaces/cockpit`, and `claude plugin marketplace update cockpit` keeps it
current. When you added it from a local clone of the repo, use that clone's path instead. The
`installPath` of the mod changes with each version, so avoid it. The script needs Node 22.18 or
later, which runs its TypeScript as is.

On Windows, Claude Code runs the status line command through Git Bash when it is installed and
through PowerShell otherwise, and PowerShell cannot run a `.sh` file. Point the command at Node
instead, with forward slashes, which work in both shells:

```json
{ "statusLine": { "type": "command", "command": "node ~/.claude/plugins/marketplaces/cockpit/hud/statusline/statusline.ts", "refreshInterval": 5 } }
```

Run this way, the script takes the 4 padding columns off `COLUMNS` itself.

`refreshInterval` re-runs the script every 5 seconds, so git, the PR and the session time stay
current while the session is idle. Without it, the status line redraws only on Claude Code's events,
such as a new message.

### The styles

With the `style` option. Each style drops its least useful fields first when the terminal is
narrow, so no row passes the width.

```text
refined   󰚩 Opus 5.5    my-app    feat/hud-git   2   1   3    #252            12m  ·  37 calls
          ctx ●●●●○○○○○○ 38%   5h ●○○○○○○○○○ 11%  resets 4h13m   7d ●●●●●●○○○○ 59%   󰍛 1.8G free

blocks     󰚩 Opus 5.5    my-app    feat/hud-git   2   1   3    #252              12m
           ctx 38%   5h 11%  resets 4h13m  7d 59%   󰍛 1.8G free

minimal   my-app  feat/hud-git  2 to push · 1 staged · 3 modified  PR #252 passing   Opus 5.5 · 12m
          context ━━━━────── 38%    5-hour ━───────── 11% 4h13m    weekly ━━━━━━──── 59%    1.8G free

compact    my-app   feat/hud-git  2  1  3   252   󰚩 Opus 5.5
          ctx 38% │ 5h 11%  4h13m │ 7d 59% │ 󰍛 1.8G
```

`compact` is one row when it fits and two when it does not. `blocks` paints each block's background.

### Git and the PR

The git field shows the branch, then commits to push, commits to pull, files staged, files changed
outside the stage and untracked files, or `synced` when there is nothing. The PR is the branch's
open pull request from `gh pr view`, with its checks: passing, failing or running. `gh` takes about a
second, so the script runs it in the background at most once a minute, caches the answer in
`~/.local/state/mods/hud/pr/`, and shows the last answer meanwhile. Without `gh`, or without an open
PR, the field is left out.

### Icons

With `icons` set to `nerd`, the default, the git, folder, model and memory fields use Nerd Font
glyphs, which show only when the terminal's font is a Nerd Font. With `unicode`, they use `↑ ↓ + ● ? ✓`
and no glyph for the folder, the model and the memory.

### Where the data comes from

The status line reads the model, the folder, the context window and the plan limits from the JSON
Claude Code pipes to it, so they show from the session's first screen, before any prompt. It reads
git and the memory itself. The tool call count comes from the mod, which writes it at each
call to `~/.local/state/mods/hud/live/<session>.json` and removes the file when the session ends.
Without the file, the row shows `0 calls`.

Claude Code draws uncolored status line text in gray, so the names that should stand out are bold.

With `band` set to `off`, the band still draws the activity row while a turn runs, unless
`activity` is `false`.

## What the band shows

The `panel` band, two rows. The right side of the first row sits flush with the last column:

```text
Opus 5.5 · my-app  main●                              38m · 214 calls
ctx ▰▰▰▰▱▱▱▱▱▱  42%   5h ▰▰▰▰▰▰▱▱▱▱  61% resets 2h30m   7d ▰▰▰▰▱▱▱▱▱▱  44%   mem 1.9G free
```

While a turn runs and another mod left a note, the activity row follows. It hides when the turn
ends, and while the turn has no note:

```text
loop-breaker: repeated error
```

Claude Code already draws the running tool, its errors, its time, the subagents and the turn's time, so the band
leaves them out. `/hud` still lists the tool and the subagents in its `NOW` row.

| Field | Source | Colors |
| :- | :- | :- |
| Model | `$.session.model()`: `claude-opus-5-5` reads `Opus 5.5`. An unknown id shows as given. | |
| Project and branch | The basename of the working directory, and `git status` in it. `●` marks uncommitted changes. Hidden outside a repo. | |
| `38m · 214 calls` | Time since the session started, and the tool calls it made | |
| `ctx` | Context window fill | green below 60%, yellow below 85%, red from 85% |
| `5h`, `7d` | The plan's 5-hour and 7-day windows. `resets 2h30m` is the time left until the window resets, `resets 3d20h` past a day. | green below 75%, yellow below 90%, red from 90% |
| `mem` | Memory that still fits before the tightest cgroup limit, minus a 2% margin. Without a cgroup limit, as on macOS and Windows, the machine's available memory. Hidden wherever neither can be read. | yellow below 1 GB, red below 500 MB |
| Activity row | The latest note another mod added to a tool result, such as a loop-breaker loop check or a memory-guard single-process rerun. Claude Code already shows failed tool calls in red | yellow |

In a narrow terminal the band drops fields instead of wrapping. The panel first shortens its bars,
then drops `mem`, then shows `7d`, `5h` and `ctx` as percents only, then drops the reset countdown.
Free text, such as a long command, is cut with `…`. Figures are never cut.

## The /hud pane

```text
SESSION   Opus 5.5 · my-app  main● · 38m · 214 calls · ctx 42%
LIMITS    5h 61% resets 2h30m · 7d 44% resets 3d20h
MEMORY    session 1.5G · slice 3.0/5.0G · 1.9G fits
NOW       Bash yarn turbo run test 0:42 · 2 subagents
TODAY     2 skills · 1 loop nudge · 0 refusals
```

- `MEMORY` names the session's own cgroup and the group whose limit sets the headroom, or the machine's memory without a cgroup limit. The row is left out when there is no reading.
- `TODAY` counts today's lines in the other mods' diaries under `~/.local/state/mods`: skill-loader
  `loaded`, loop-breaker `nudge`, usage-limit `tool-refused` and memory-guard `refused`.

The pane refreshes every 2 seconds while it is open. Press `r` to refresh now and Esc to close it.

## Options

Set the options in `/config`, or under `pluginConfigs` in `~/.claude/settings.json`.

| Option | Default | What it does |
| :- | :- | :- |
| `enabled` | `true` | Off, the mod does nothing: no band, no activity row, no `/hud`, and the status line script prints an empty line. Takes effect in the next session, or after `/reload-plugins`. |
| `band` | `panel` | `panel` draws the two rows above. `line` draws one row. `off` leaves the band to the other mods and to the activity row, and `/hud` still works. Use `off` with the status line. |
| `activity` | `true` | Shows the activity row while a turn runs |
| `memory` | `true` | Shows the memory headroom in the band and the `MEMORY` row |
| `bar` | `dots` | The bar glyphs: `blocks` (`▰▱`), `solid` (`█░`), `line` (`━─`), `dots` (`●○`) or `squares` (`■□`) |
| `barWidth` | `10` | Cells of a full-width bar, 4 to 30. A narrow terminal still shrinks the bars |
| `colors` | empty | The colors for ok, warning and critical, separated by spaces. Each one is a name (`green`, `bright-cyan`), `#rrggbb` or a 256-color number. Empty uses green, yellow and red |
| `hide` | empty | Fields to leave out, separated by commas: `model`, `project`, `branch`, `age`, `calls`, `ctx`, `5h`, `7d`, `reset`, `mem` |
| `barColor` | `gradient` | `gradient` colors each bar cell by its place, green to red. `solid` colors the whole bar by its percent. `tone` keeps the three threshold colors of `colors`. The percents follow the same color |
| `style` | `refined` | The status line layout: `refined`, `blocks`, `minimal` or `compact` |
| `icons` | `nerd` | `nerd` for Nerd Font glyphs, `unicode` for plain marks |
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

## Cost

The band's render hook does no I/O. It lays out values that events and timers already read. The
work it causes:

- During a turn, a 1-second timer reads `$.agent.list()` for `/hud`, and redraws only while the
  pane is open. The timer stops when the turn ends.
- Every 15 seconds, idle or not, one `git status` (3-second timeout) and a memory reading: on Linux,
  the files under `/sys/fs/cgroup` and `/proc/meminfo`; on macOS, `sysctl -n hw.memsize` and
  `vm_stat` (2-second timeout); on Windows, one PowerShell run of `Get-CimInstance
  Win32_OperatingSystem` (5-second timeout, about a second to start, an estimate). A command reading
  stays fresh for 15 seconds. The band redraws only when what it shows changed.
- The status line script reads memory at each redraw: on macOS one `vm_stat` (1-second timeout); on
  Windows Node's own figures, with no command.
- Each tool call adds two redraw requests, one at its start and one at its end. Claude Code throttles
  redraws to 10 a second and merges the rest.
- `/hud` reads today's diaries. While the pane is open, it lists the
  folders every 2 seconds and reads a file again only when its size changed.

At the end of each session the mod writes one summary line to
`~/.local/state/mods/hud/<day>-<session>.jsonl`: tool calls seen, the hook's own time per call, the
number of band renders and the slowest one.

## Limits

- On Linux the memory comes from cgroup v2 and `/proc/meminfo`. On macOS it is the free, inactive,
  speculative and purgeable pages of `vm_stat` against `hw.memsize`; on Windows, `FreePhysicalMemory`
  against `TotalVisibleMemorySize`, and in the status line Node's `os.freemem()`, which reads the same
  available physical memory. Both have no per-session limit, so the field shows the whole machine.
- The macOS and Windows readings are tested only against simulated `vm_stat` and PowerShell output,
  not on a Mac or a Windows PC.
- When the reading fails, or on another system without `/proc/meminfo`, the memory field is left out.
- On Windows, point the status line at `statusline.ts` through Node, as above. The Windows setup is
  not tested.
- On Windows without `HOME`, `~` is `USERPROFILE`, for the mod and the script alike.
- The band, the status line and the `/hud` pane are drawn by Claude Code's terminal interface.
  Tested only in a terminal.
- The PR field needs the GitHub CLI, `gh`, signed in. Without it the field is left out.

## Develop

```sh
claude plugin validate .
claude plugin test
tsc -p .
```
