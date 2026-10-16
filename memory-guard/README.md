# memory-guard

Keeps typecheck, build, test and Playwright runs under the memory limit, so they do not run out of memory, and reruns a command killed with exit 137 with one process. On Linux the limit is the tightest cgroup limit or the machine's memory; on macOS and Windows it is the machine's memory. See Limits.

## Why

On Linux, when memory runs out, or a cgroup reaches its `memory.max`, the kernel kills the largest process, which is usually the heavy command, and the agent sees exit 137 without knowing why. This mod checks the headroom before a heavy command runs and adapts the command to it.

## What it does

Before a heavy command runs, the mod compares its expected peak with the headroom, minus the margin. The headroom is the machine's available memory, or the room left under the tightest cgroup limit when the session runs in one, as under a systemd service or in a container:

1. If the command fits, it runs as written.
2. If only a single process fits, the mod adds `--concurrency=1`, `--workers=1` or `--maxWorkers=1` and tells the agent.
3. If nothing fits, the mod waits up to `waitSeconds` for memory to free up.
4. If memory does not free up, the mod refuses the command and tells the agent what uses the memory.

After the command, the mod stores its measured peak for the next estimate, and reruns with a single process a command that died with exit 137. Until a command is measured, the estimates are 1 GB for typecheck and build, 600 MB for tests and 500 MB for Playwright.

Without a cgroup limit, as on most Linux desktops and laptops, the headroom is `MemAvailable` from `/proc/meminfo`. On macOS it is the free, inactive, speculative and purgeable pages of `vm_stat`, against the total of `sysctl -n hw.memsize`. On Windows it is `FreePhysicalMemory` against `TotalVisibleMemorySize`, read through PowerShell from `Win32_OperatingSystem`. Under a cgroup limit, it counts the working set: `memory.current` minus `inactive_file`, which the kernel frees before it kills anything.

## Commands

- `/ram` shows the headroom, each cgroup's use and limits when there are any, and the measured peaks. It says there is no memory reading when the system gives none. In a terminal it also opens the Memory pane: a bar per cgroup with the high mark, refreshed every 2 seconds. Press `r` to refresh and `esc` to close.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `margin` | `2` | Share of memory kept free: of each cgroup's `memory.max`, or of the machine's total without a cgroup limit. The high mark counts only for a cgroup with no max. |
| `waitSeconds` | `120` | How long a heavy command waits for memory before it is refused. |

## What it records

- `~/.local/state/mods/memory-guard/<day>-<session>.jsonl`: one line per reduced, refused or retried command and per measured peak, plus one `session-summary` line with the time commands waited. Each line has `at`, `session` and `event`.
- The last 3 measured peaks of each command, in the shared mod store under `peaks`.

## Cost

The hook added about 4 ms per Bash call on the author's Linux machine, not counting the time commands waited for memory (56 calls measured in October 2026, an estimate). Each heavy command also reads the memory files once a second while it runs, to measure its peak. On macOS and Windows a reading runs a command instead, and stays fresh for 10 seconds: `sysctl` and `vm_stat` take a few milliseconds, and PowerShell about a second to start (an estimate).

## Limits

- The peak is measured on the whole cgroup, or the whole machine without one, so another session starting at the same time inflates it. Keeping only the last 3 measurements lets an inflated one age out.
- `tsc` has no flag for a single process, so a typecheck that does not fit waits or is refused.
- A background command returns at once and gives no measurement.
- The macOS and Windows readings are tested only against simulated `vm_stat`, `sysctl` and PowerShell output, not on a Mac or a Windows PC.
- On macOS and Windows the headroom is the whole machine's: there is no per-session limit to keep under, and a reading can be up to 10 seconds old, so a peak measured there is coarser than on Linux.
- When the reading fails (no `/proc/meminfo`, a command missing, slower than its timeout of 2 seconds for `sysctl` and `vm_stat` or 5 seconds for PowerShell, or printing something else), heavy commands run as they came, nothing waits or is refused, no peak is stored and the status stays empty. `/ram` says there is no reading. The rerun with one process after an exit 137 still applies.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install memory-guard@cockpit
```

The `cockpit` bundle installs it with the other mods.
