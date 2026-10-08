# rating

Records every agent turn as a dataset with your 1-5 ratings and automatic weak labels, for analysis and fine-tuning.

## Why

Knowing which answers landed and which missed takes data, not memory. This mod turns each turn into a record you can rate in one keystroke, and labels the rest from how you reacted, so the dataset grows without extra work.

## What it does

- Each completed main-loop turn goes to `turns/` with its prompt, answer, tool calls (subagents' included), skills and usage.
- Your ratings go to `ratings/`. Rate with `/rate`, or type a digit from 1 to 5 into an empty prompt while the band shows.
- At your next prompt, the turn before gets its weak labels in `signals/`: retried, corrected, approved, aborted, loop nudges, tool errors and refusals, with an implicit score.

The implicit score starts at 3: approval +1.5, correction -1.5, retry -1, abort -2, -0.5 per loop nudge (at most -1), -0.25 per refusal (at most -1), clamped to 1-5. The correction and approval phrases, in English and Portuguese, are in `hooks/rules.ts`.

The mod lists secret-guard, loop-breaker and skill-loader as dependencies, so it runs before them and records each tool result after secrets are hidden and after the nudges and skill text are attached.

## Commands

- `/rate <1-5> [tags...] [-- comment]` rates the last turn, as in `/rate 2 verbose wrong-file -- read the whole repo for a one-line fix`.
- `/rate` shows the last turn with your score and its implicit score.
- `/ratings [days]` reports turns, ratings, scores per project and per skill, the effect of loop nudges and refusals, and the five lowest-rated turns. Plain text, so it reads the same in Remote Control. In a terminal it also opens the Ratings pane.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `datasetDir` | `~/datasets/agent-ratings` | Folder of the turns, ratings and signals files. |
| `skipTemporary` | `true` | Sessions opened in a temporary folder (`/tmp`, `TMPDIR`) or run with a temporary `CLAUDE_CONFIG_DIR` are tests: they write nothing to the dataset and show no band. |
| `band` | `true` | Show the rating row above the prompt after each answer. |
| `configRepo` | empty | Git repo whose short HEAD commit each turn records as `configVersion`, such as the repo that holds your Claude Code settings. Empty records none. |

## What it records

JSONL files, one per UTC day, under `datasetDir`. Every session appends under `flock`, so a line longer than 4 KiB never interleaves with another.

| File | One line per | Fields |
| :- | :- | :- |
| `turns/<day>.jsonl` | Completed main turn | `id` (`<session8>:<turnId>`), `session`, `at`, `endedAt`, `cwd`, `project`, `model`, `origin`, `prompt`, `answer`, `aborted`, `durationMs`, `usage`, `tools`, `skills`, `configVersion` |
| `ratings/<day>.jsonl` | Rating you gave | `turn`, `score` (1-5), `tags`, `comment`, `at`, `source: "user"` |
| `signals/<day>.jsonl` | Turn, labeled at your next prompt or at session end | `turn`, `signals`, `implicitScore` (1-5), `source: "implicit"` |

Each `tools` item holds `tool`, `agentId` for a subagent's call, `input` (each field cut to 1000 characters), `outcome` (`ok`, `error` or `denied`), `output` (cut to 2000 characters), `ms`, and `nudged` when loop-breaker attached a note. When a turn has several lines in `ratings` or `signals`, the last one wins. `configVersion` is the short commit of `configRepo`, so you can compare scores across configuration changes, or `null` when `configRepo` is empty.

One `session-summary` line per session goes to `~/.local/state/mods/rating/<day>.jsonl`, for `/mods`.

## Export

```sh
node bin/export.mjs --format sft --min-score 4 --source user --out sft.jsonl
node bin/export.mjs --format dpo --source both --out dpo.jsonl
node bin/export.mjs --format reward --source both --since 2026-10-01 --out reward.jsonl
```

| Format | Line | Selection |
| :- | :- | :- |
| `sft` | `{ messages: [user, assistant], meta: { id, project, model, score, source, tools } }` | Turns scored at least `--min-score`, not aborted, with an answer |
| `reward` | `{ prompt, response, score, source, id }` | Every scored turn |
| `dpo` | `{ prompt, chosen, rejected, meta: { chosen, rejected } }` | In one session, a turn scored 2 or less and, within the next 3 turns, one scored 4 or more, where each prompt in between retried or corrected the turn before it |

`--source` is `user` (the default), `implicit` or `both`. With `both`, your score wins over the implicit one. `--dir` defaults to `~/datasets/agent-ratings`. The selection logic is in `bin/lib.mjs`, tested by `tests/export.test.ts`.

## Cost

The hook added about 19 ms per tool call on the author's VPS (17 calls measured in October 2026, an estimate), most of it the `flock` append at the end of each turn.

## Limits

- The dataset holds prompts, answers and tool output in plain text. Keep `datasetDir` private.
- The weak labels read your next prompt with fixed phrase lists, so sarcasm and indirect corrections are missed.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install rating@cockpit
```

The `cockpit` bundle installs it with the other mods.
