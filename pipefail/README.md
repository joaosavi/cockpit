# pipefail

Adds `set -o pipefail;` to a command that pipes a test, typecheck or lint run into `tail`, `head` or `grep`.

## Why

A pipeline exits with the code of its last command. `yarn test | tail -20` exits 0 when tests fail, because `tail` succeeded, and the agent reads a pass. Rewriting the command costs nothing and saves the agent a wrong conclusion.

## What it does

- Matches a runner where it runs: `yarn`, `npm run`, `pnpm` or `bun run` with `test`, `e2e`, `typecheck`, `lint`, `check` and similar scripts, or with a script named in `extraRunners`, `turbo run`, `vitest`, `jest`, `playwright test`, `tsc`, `vue-tsc`, `eslint`, `pytest`, `go test` and `cargo test`. Quoted text and heredoc bodies do not count.
- Puts `set -o pipefail;` in front, runs the command, and tells the agent that a `| head` can make a runner exit 141 (SIGPIPE).
- Leaves alone a command that already mentions `pipefail`.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `extraRunners` | empty list | Script names that also count as runners when a package manager calls them: `yarn <name>`, `npm run <name>`, `pnpm <name>`, `bun run <name>`. |

Add a repo's own check script here when its exit code says whether the code works, such as `verify` for a script that runs lint, types and tests. The mod then rewrites `yarn verify | tail` too.

## What it records

`~/.local/state/mods/pipefail/<day>-<session>.jsonl`: one line per rewrite naming the runner (`yarn vitest`, never the whole command), plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

The hook added about 2 ms per Bash call on the author's Linux machine (56 calls measured in October 2026, an estimate).

## Limits

- Only `tail`, `head` and `grep` as the filter. Other filters, such as `sed` or `awk`, are left alone.
- A runner hidden inside a script the command calls is not seen.
- Only the Bash tool. On Windows without Git Bash, commands run through the PowerShell tool and the mod leaves them alone. Tested on Linux only.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install pipefail@cockpit
```

The `cockpit` bundle installs it with the other mods.
