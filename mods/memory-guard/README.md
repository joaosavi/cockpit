# memory-guard

Keeps typecheck, build, test and Playwright runs under the session's cgroup memory limit, so the kernel does not kill them.

## Why

When a cgroup reaches its `memory.max`, the kernel kills the largest process in it, which is usually the heavy command, and the agent sees exit 137 without knowing why. This mod checks the headroom before a heavy command runs and adapts the command to it.

## What it does

Before a heavy command runs, the mod compares its expected peak with the headroom of the tightest cgroup, minus the margin:

1. If the command fits, it runs as written.
2. If only a single process fits, the mod adds `--concurrency=1`, `--workers=1` or `--maxWorkers=1` and tells the agent.
3. If nothing fits, the mod waits up to `waitSeconds` for memory to free up.
4. If memory does not free up, the mod refuses the command and tells the agent what uses the memory.

After the command, the mod stores its measured peak for the next estimate, and reruns with a single process a command that died with exit 137. Until a command is measured, the estimates are 1 GB for typecheck and build, 600 MB for tests and 500 MB for Playwright.

The headroom counts the working set: `memory.current` minus `inactive_file`, which the kernel frees before it kills anything. Without a cgroup limit, as on a laptop, the machine's available memory applies.

## Commands

- `/ram` shows the headroom, each cgroup's use and limits, and the measured peaks. In a terminal it also opens the Memory pane: a bar per cgroup with the high mark, refreshed every 2 seconds. Press `r` to refresh and `esc` to close.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `margin` | `2` | Share of each cgroup's `memory.max` kept free. The high mark counts only for a cgroup with no max. |
| `waitSeconds` | `120` | How long a heavy command waits for memory before it is refused. |

## What it records

- `~/.local/state/mods/memory-guard/<day>-<session>.jsonl`: one line per reduced, refused or retried command and per measured peak, plus one `session-summary` line with the time commands waited. Each line has `at`, `session` and `event`.
- The last 3 measured peaks of each command, in the shared mod store under `peaks`.

## Cost

The hook added about 4 ms per Bash call on the author's VPS, not counting the time commands waited for memory (56 calls measured in October 2026, an estimate). Each heavy command also reads the cgroup files once a second while it runs, to measure its peak.

## Limits

- The peak is measured on the whole cgroup, so another session starting at the same time inflates it. Keeping only the last 3 measurements lets an inflated one age out.
- `tsc` has no flag for a single process, so a typecheck that does not fit waits or is refused.
- A background command returns at once and gives no measurement.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install memory-guard@agent
```

The `agent` bundle installs it with the other mods.
