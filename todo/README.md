# todo

Keeps Claude Code's native task list in front of the agent: the open tasks at session start and on each prompt from the user, a reminder that a new request becomes a task first, and completed tasks moved to an archive log.

## Why

The task tools (`TaskCreate`, `TaskList`, `TaskUpdate`, `TaskGet`) write one JSON file per task in `~/.claude/tasks/<list>/`, so the list outlives a compaction, `--resume` and `--continue`. The model forgets that the list is there. After a compaction it works from the summary, and a request that lived only in the conversation is lost. A session that takes many requests, such as a manager that hands work to other agents, needs the list read back to it from disk.

## What it does

- At session start, adds a note with the open tasks of the session's list.
- On each prompt from the user, attaches the open tasks and the tasks completed since the last prompt. A prompt from the user is one typed in the terminal or the app, one from a channel such as Telegram, or a `claude -p` prompt. Messages from other sessions, notifications and schedules get nothing.
- With a named list (`CLAUDE_CODE_TASK_LIST_ID`), the same prompt also carries the rule: a new request becomes a `TaskCreate` before any other work, with its owner in the subject, such as `[owner] what was asked`.
- Moves a completed task to `~/.local/state/mods/todo/<list>.jsonl` and deletes its file, so the list holds only open work. This covers a task completed by `TaskUpdate` in the session and a task file a script rewrote.
- Right after a compaction, adds the open tasks as the last message, where the plan allows it. See [Limits](#limits).

The list is the one Claude Code uses: `CLAUDE_CODE_TASK_LIST_ID` when it is set, and the session's own list otherwise.

## Turn on the task tools

Claude Code offers the task tools by default only on Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier models. To get them on a newer model, start Claude Code with the variable set:

```sh
CLAUDE_CODE_ENABLE_TODO_TOOLS=1 claude
```

To share one list between sessions, name the list:

```sh
CLAUDE_CODE_ENABLE_TODO_TOOLS=1 CLAUDE_CODE_TASK_LIST_ID=requests claude
```

Without the tools, the mod still shows a list that a script filled, but the agent cannot change the list.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `enabled` | `true` | Off, the mod does nothing. Takes effect in the next session, or after `/reload-plugins`. |
| `remind` | `true` | With a named list, each prompt from the user carries the request rule. |
| `archive` | `true` | Moves completed tasks from the list to the archive log. Off, completed tasks stay in the list. |

## What it records

- `~/.local/state/mods/todo/<list>.jsonl`: one line per archived task, with its id, subject and description.
- `~/.local/state/mods/todo/<day>-<session>.jsonl`: one line per note, prompt context and archive run, plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

The open tasks go in whole with each prompt from the user, at about 15 tokens per task. The note lists 30 tasks at most and counts the rest. The only `tool.call` hook is on `TaskUpdate`.

## Limits

- On a Team or Enterprise plan, the built-in guard `sec-default@builtin` skips the `session.compact` hook of a mod you installed yourself. There, the note right after a compaction does not appear, and the next prompt from the user carries the list. If a session must see the list right after a compaction, add a `SessionStart` hook with the matcher `compact` to its `settings.json`, and make the hook print the open tasks.
- Task ids restart at 1 after every file has left the list. The archive keeps the subject next to each id.
- Tested on Linux only. On Windows, the mod deletes completed tasks with `del`.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install todo@cockpit
```

The `cockpit` bundle installs it with the other mods.
