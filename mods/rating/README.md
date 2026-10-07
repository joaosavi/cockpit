# rating

Records every main-loop turn of the agent as a dataset, with your ratings and automatic weak
labels, for analysis and fine-tuning (SFT, DPO preference pairs, reward modeling).

## Files

All files are JSONL, one file per UTC day, under `datasetDir` (default `~/datasets/agent-ratings`).
Each session appends under `flock`, so concurrent sessions never interleave a line.

| File | One line per | Fields |
| :- | :- | :- |
| `turns/<day>.jsonl` | Completed main turn | `id` (`<session8>:<turnId>`), `session`, `at`, `endedAt`, `cwd`, `project`, `model`, `origin`, `prompt`, `answer`, `aborted`, `durationMs`, `usage`, `tools`, `skills`, `configVersion` |
| `ratings/<day>.jsonl` | Rating you gave | `turn`, `score` (1-5), `tags`, `comment`, `at`, `source: "user"` |
| `signals/<day>.jsonl` | Turn, labeled at the next human prompt or at session end | `turn`, `signals` (`aborted`, `retried`, `correction`, `approval`, `loopNudges`, `toolErrors`, `refusals`), `implicitScore` (1-5), `source: "implicit"` |

Each `tools` item holds `tool`, `agentId` for a subagent's call, `input` (each field cut to 1000
characters), `outcome` (`ok`, `error` or `denied`), `output` (cut to 2000 characters), `ms`, and
`nudged` when the loop-breaker mod attached a loop check. When a turn has several lines in
`ratings` or `signals`, the last line wins.

The implicit score starts at 3: approval +1.5, correction -1.5, retry -1, abort -2, -0.5 per loop
nudge (at most -1), -0.25 per refusal (at most -1), clamped to 1-5. The correction and approval
phrases are in `hooks/rules.ts`.

The mod runs before secret-guard, loop-breaker and skill-loader, so it records tool output after
secrets are hidden and after the nudges and skill text are attached.

## Rate

- `/rate 4 verbose wrong-file -- read the whole repo for a one-line fix` rates the last turn.
- `/rate` shows the last turn, its user score and its implicit score.
- In the terminal, the row above the prompt takes one digit: type `1` to `5` into an empty prompt.
- `/ratings [days]` reports turns, ratings, scores per project and per skill, the effect of loop
  nudges and refusals, and the five lowest-rated turns.

## Export

```sh
node bin/export.mjs --format sft --min-score 4 --source user --out sft.jsonl
node bin/export.mjs --format dpo --source both --out dpo.jsonl
node bin/export.mjs --format reward --source both --since 2026-10-01 --out reward.jsonl
```

| Format | Line | Selection |
| :- | :- | :- |
| `sft` | `{ messages: [user, assistant], meta: { id, project, model, score, source, tools } }` | Turns with score >= `--min-score`, not aborted, with an answer |
| `reward` | `{ prompt, response, score, source, id }` | Every scored turn |
| `dpo` | `{ prompt, chosen, rejected, meta: { chosen, rejected } }` | In one session, a turn scored <= 2 and, within the next 3 turns, one scored >= 4, where each prompt in between retried or corrected the turn before it |

`--source` is `user` (default), `implicit` or `both`. With `both`, the user's score wins over the
implicit one. `--dir` defaults to `~/datasets/agent-ratings`. The selection logic is in
`bin/lib.mjs`, tested by `tests/export.test.ts`.
