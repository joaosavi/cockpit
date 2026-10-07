# secret-guard

Hides every secret value in tool output before the agent reads it.

## Why

A secret that reaches the transcript is sent to the model and kept in the session log, and from then on it must be rotated. Tool output leaks secrets easily: `env`, `cat .env`, a stack trace with a connection string. This mod replaces each value with `<hidden:NAME>` in every tool result, built-in, MCP and subagent alike.

## What it does

- The values come from the secrets file, from every `.env*` file under the `.env` root (5 levels deep) when you set one, from environment variables with a secret-looking name (`TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `AUTH` and others), and from the password of every `scheme://user:password@` URL. Known token formats (GitHub, Anthropic, AWS, Slack) are hidden even when no list has them.
- A value that also appears in a `.example` file is already public and stays visible.
- When the agent writes `<hidden:NAME>` into a `.env` file or the secrets file, the mod writes the real value in its place. The agent can edit those files without ever seeing a value.
- If the mod itself fails, it withholds the output instead of passing it unchecked.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `secretsFile` | `~/.secrets` | `KEY=value` file whose every value is a secret, whatever its name. |
| `envRoot` | empty | Folder searched for `.env` files, 5 levels deep. Empty searches none. |
| `minLength` | `12` | Shorter values are left alone, except known token formats. |

By default the mod reads no `.env` files: the list holds the secrets file, the environment variables, their URL passwords, and the known token formats. To cover your projects' `.env` files too, set `envRoot` to the folder that holds your repos, such as `~/code`. The mod then scans it at start, checks its folders for new `.env` files at most once a minute, and rebuilds the list at least every 10 minutes.

## What it records

`~/.local/state/mods/secret-guard/<day>-<session>.jsonl`: one line each time the list is rebuilt, a result is redacted or a placeholder is restored, with secret names and counts only, plus one `session-summary` line. Each line has `at`, `session` and `event`. The values live only in the mod's memory, never on disk.

## Cost

The hook added about 64 ms per tool call on the author's VPS (60 calls measured in October 2026, an estimate), with `envRoot` set to a folder of about 140 subfolders, most of it checking whether a source file changed.

## Limits

- A secret shorter than `minLength` that matches no known format stays visible.
- A secret that the agent already saw before this mod loaded is still in the transcript.
- A `.env` file outside `envRoot` is not read, so its values stay visible unless another source has them.
- The mod also restores `<oculto:NAME>`, the placeholder an earlier Perl hook wrote.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install secret-guard@agent
```

The `agent` bundle installs it with the other mods.
