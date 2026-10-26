# todo

Keeps Claude Code's native task list in front of the agent: the open tasks at session start and on each prompt from the user, a reminder that a new request becomes a task first, completed tasks logged to an archive, and the Claude app's task panel kept in line with the task files.

## Why

The task tools (`TaskCreate`, `TaskList`, `TaskUpdate`, `TaskGet`) write one JSON file per task in `~/.claude/tasks/<list>/`, so the list outlives a compaction, `--resume` and `--continue`. The model forgets that the list is there. After a compaction it works from the summary, and a request that lived only in the conversation is lost. A session that takes many requests, such as a manager that hands work to other agents, needs the list read back to it from disk.

## What it does

- At session start, adds a note with the open tasks of the session's list.
- On each prompt from the user, attaches the open tasks and the tasks completed since the last prompt. A prompt from the user is one typed in the terminal or the app, one from a channel such as Telegram, or a `claude -p` prompt. Messages from other sessions, notifications and schedules get nothing.
- With a named list (`CLAUDE_CODE_TASK_LIST_ID`), the same prompt also carries the rule: a new request becomes a `TaskCreate` before any other work, with its owner in the subject, such as `[owner] what was asked`.
- Logs a completed task to `~/.local/state/mods/todo/<list>.jsonl` once. This covers a task completed by `TaskUpdate` in the session and a task file a script rewrote. After `keepCompletedHours`, the prompt asks the session to remove the task with `TaskUpdate` (status `deleted`).
- Keeps the task panel of the Claude app in line with the task files. See [The app's task panel](#the-apps-task-panel).
- Right after a compaction, adds the open tasks as the last message, where the plan allows it. See [Limits](#limits).

The list is the one Claude Code uses: `CLAUDE_CODE_TASK_LIST_ID` when it is set, and the session's own list otherwise.

## The app's task panel

The task panel of the Claude app (claude.ai and the phone, in a Remote Control session) never reads the task files. It builds the list from the session's own `TaskCreate` and `TaskUpdate` calls:

- A `TaskCreate` counts once its result names the id, and only when the panel does not hold that id yet.
- A `TaskUpdate` applies its input whatever the tool answers. An update on an id the panel never saw shows the bare id, such as `Task #15`, with no subject.
- `TaskUpdate` with status `deleted` drops the task.

So a task file that a script rewrote or removed stays in the panel as it was. The mod keeps its own copy of the panel, from the same calls, in `~/.local/state/mods/todo/panel/<session>.json`. When the copy and the files differ, the next prompt from the user asks the session for the `TaskUpdate` calls that fix the panel, 40 at most per prompt:

| On disk | In the panel | Call |
| :- | :- | :- |
| No file | Listed | `{"taskId": "N", "status": "deleted"}` |
| Other subject or status | Listed | the file's subject and status |
| Open | Not listed | the file's subject and status |
| Completed for `keepCompletedHours` | Any | `{"taskId": "N", "status": "deleted"}`, which also removes the file |

The first time the mod sees a session, it reads the copy back from the conversation. A compaction hides the calls made before it, so after one, every id up to the highest the list handed out is marked unknown and synced once.

The mod never deletes a task file. Claude Code gives a new task the next id after the highest file or after the `.highwatermark` file in the list folder, and only its own delete raises that mark. A file removed any other way hands its id to the next task, and the panel then drops that new task, because it already holds the id. At session start the mod raises the mark past every id in the archive log, for lists that lost ids that way.

## Order of the list

The open tasks go in one group per state, with a count, such as `waiting (2):`.

- A task's priority and state come from `metadata.priority` and `metadata.state` in its file. Without metadata, they come from a subject such as `[owner] P1 waiting: what was asked`: the `P` number after the owner, then the word before the colon.
- A task with no state goes in the group of its native status, `in_progress` or `pending`.
- In each group, tasks go from P0 up, then the ones with no priority, then by id.
- The group that holds the most urgent task comes first. On a tie, the group with a task in progress comes first.

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
| `archive` | `true` | Logs completed tasks to the archive log, and asks the session to remove them after `keepCompletedHours`. Off, completed tasks stay in the list. |
| `keepCompletedHours` | `24` | How long a completed task stays in the list and in the app's panel. `0` removes it at the next prompt. |

## What it records

- `~/.local/state/mods/todo/<list>.jsonl`: one line per archived task, with its id, subject and description.
- `~/.local/state/mods/todo/<list>.done.json`: the completed tasks still in the list, with the time the mod first saw each one completed.
- `~/.local/state/mods/todo/panel/<session>.json`: the mod's copy of the app's task panel for that session.
- `~/.local/state/mods/todo/<day>-<session>.jsonl`: one line per note, prompt context and archive run, plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

The open tasks go in whole with each prompt from the user, at about 15 tokens per task. The note lists 30 tasks at most and counts the rest. Each panel fix is one `TaskUpdate` call, about 30 tokens. The `tool.call` hooks are on `TaskCreate` and `TaskUpdate`.

## Limits

- On a Team or Enterprise plan, the built-in guard `sec-default@builtin` skips the `session.compact` hook of a mod you installed yourself. There, the note right after a compaction does not appear, and the next prompt from the user carries the list. If a session must see the list right after a compaction, add a `SessionStart` hook with the matcher `compact` to its `settings.json`, and make the hook print the open tasks.
- The panel copy follows the calls of the main conversation. A subagent's task calls never reach the app's panel, and the copy leaves them out too.
- A session without the task tools cannot make the calls, so its panel stays as it is.
- Tested on Linux only.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install todo@cockpit
```

The `cockpit` bundle installs it with the other mods.
