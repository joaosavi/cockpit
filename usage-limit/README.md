# usage-limit

Keeps the account usage limit from running out in the middle of a task.

## Why

When a 5-hour or 7-day window reaches 100%, the session stops wherever it is, often mid-edit, and nothing resumes it. This mod slows down before that point, has the agent commit its work, stops at a reserve you keep for yourself, and resumes the session on its own when the window resets.

## What it does

- From the alert (90% by default), only one subagent runs at a time.
- At 97% by default, the agent is asked once per window to commit its work in progress in each repository it changed, with a `wip:` message and without pushing. It stages only the files it changed, so the work of another session in the same repository stays out. Only the main conversation gets the request.
- At the pause (98% by default), every tool call is refused except a command that only stages and commits (`git add`, `git commit`, `cd`, chained with `&&`), so the work still gets committed when a burst of requests jumps straight past 97%. The agent writes in up to 3 lines where it stopped, and the mod schedules the resume for the reset time plus 2 minutes.
- A prompt you type during the pause gets one turn without subagents, spent from the reserve.
- A prompt nobody typed (a routine, another session, a task notification) is held and delivered with the resume.
- The band above the prompt shows each window with a bar, the pause mark, the percent and the reset time, from 75% by default.
- The status line under the prompt shows the state while the mod holds something back.

## Commands

- `/limit` shows each window, the state, and what is held for the resume. Plain text, so it reads the same in Remote Control.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `reserve` | `2` | Share of the limit kept for you. The session pauses at 100 minus this value. |
| `alert` | `90` | From this share, one subagent at a time. |
| `timeZone` | empty | IANA time zone of the reset times shown, such as `America/New_York`. Empty uses the system time zone. |
| `commitAt` | `97` | From this share, ask the agent once per window to commit without pushing. `0` turns it off. |
| `resume` | `true` | Resume the session when the window resets, after the pause or after the limit error. Off, you resume it, and automatic prompts that arrive during the pause are dropped instead of held. The pre-1.5 name `resumeOnError` still works. |
| `bandFrom` | `75` | Show the band from this share. |

## What it records

- `~/.local/state/mods/usage-limit/<day>-<session>.jsonl`: one line per state change, refusal, held prompt and resume, plus one `session-summary` line when the session ends. Each line has `at`, `session` and `event`.
- The last reading of the windows, in the shared mod store under `windows`, so a new session starts from the reading another session took.

## Cost

The `tool.call` hook added about 6 ms per tool call on the author's Linux machine (60 calls measured in October 2026, an estimate).

## Limits

- The reading arrives with each model response, so a burst of parallel requests can pass the pause before the next reading. The resume after the limit error and the commit allowed during the pause cover that case.
- A prompt with an origin Claude Code cannot classify counts as yours and spends the reserve.
- `/clear`, `/resume` and `/branch` cancel the scheduled resume and drop the held messages of the previous conversation.
- In the pause, a commit-only command passes through the Bash tool or, on Windows without Git Bash, the PowerShell tool. Tested on Linux only.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install usage-limit@cockpit
```

The `cockpit` bundle installs it with the other mods.
