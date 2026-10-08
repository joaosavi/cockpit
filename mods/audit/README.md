# audit

Records every MCP call that writes, so you can see what the agent sent on your behalf.

## Why

The agent sends Slack messages, creates drafts, updates CRM records and edits pages through MCP servers. Those calls leave no trace you can search. This mod keeps one line per write call, and refuses nothing.

## What it does

- Every MCP call whose action name does not start with a read word (`get`, `list`, `search`, `read`, `fetch` and others) counts as a write. A missing line costs more than an extra one, so an unknown action counts as a write.
- Each line holds the server, the action, the arguments (each cut to 300 characters), the outcome (`ok`, `error` or `denied`), the error text and the duration.
- Files older than the retention are removed when a session starts.

## Commands

- `/audit [count] [filter]` lists the latest write calls, newest first. `/audit 50 slack` shows the last 50 whose server or action mentions `slack`. In a terminal it also opens the Audit pane, where `m` shows 20 more, `r` refreshes and `esc` closes.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `retentionDays` | `30` | Days of audit files to keep. |
| `showCount` | `20` | Entries `/audit` shows when you give no number. |
| `timeZone` | empty | IANA time zone of the times shown, such as `America/New_York`. Empty uses the system time zone. |

## What it records

`~/.local/state/mods/audit/<day>.jsonl`, one file per UTC day shared by every session. Each line has `at`, `event` (`write-call` or `session-summary`) and `session`. The mod appends with `cat >>`, which the kernel writes in one piece for a line under 4 KiB, so two sessions never erase each other's lines.

## Cost

The hook does nothing for a read call. A write call costs one `cat >>` process after the call returns, a few milliseconds.

## Limits

- The arguments are recorded as the agent sent them. Run secret-guard with it if those arguments can carry secrets.
- Built-in tools (Bash, Edit, Write) are not recorded.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install audit@cockpit
```

The `cockpit` bundle installs it with the other mods.
