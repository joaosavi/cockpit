# secret-guard

Hides every secret value in tool output before the agent reads it.

## Why

A secret that reaches the transcript is sent to the model and kept in the session log, and from then on it must be rotated. Tool output leaks secrets easily: `env`, `cat .env`, a stack trace with a connection string. This mod replaces each value with `<hidden:NAME>` in every tool result, built-in, MCP and subagent alike.

## What it does

- The values come from the secrets file and every file in the folder beside it named like it plus `.d` (`~/.secrets.d/` by default), from every `.env*` file under the `.env` root (5 levels deep) when you set one, from environment variables with a secret-looking name (`TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `AUTH` and others), and from the password of every `scheme://user:password@` URL. Known token formats are hidden even when no list has them: GitHub, Anthropic, OpenAI, AWS, Google, Stripe, Slack, JWT and private key blocks. They show as `<hidden:github>`, `<hidden:jwt>` and so on.
- A tool that hands out secrets, such as a password vault CLI, can keep its own `NAME="value"` list in a file in the secrets folder, and the mod hides those values without that tool touching your secrets file. A file whose name starts with a dot is skipped, so the tool can write a temporary file and rename it into place.
- A value that also appears in a `.example` file is already public and stays visible.
- When the agent writes `<hidden:NAME>` into a `.env` file or the secrets file, the mod writes the real value in its place. The agent can edit those files without ever seeing a value.
- When the agent writes `<hidden:NAME>` in a Bash command, the mod runs the command with the real value, and the output comes back hidden as usual. The transcript keeps the command as written. The agent can call an API with a token it never sees.
- A placeholder the mod cannot fill stops the command instead: a token known only by its format, or a name with two different values in your files, such as the same `DATABASE_URL` in two projects. The agent is told to read the value inside the command, from its variable or `.env` file.
- If the mod itself fails, it withholds the output instead of passing it unchecked.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `enabled` | `true` | Off, the mod does nothing: every value shows in tool output as it is. Takes effect in the next session, or after `/reload-plugins`. |
| `secretsFile` | `~/.secrets` | `KEY=value` file whose every value is a secret, whatever its name. |
| `envRoot` | empty | Folder searched for `.env` files, 5 levels deep. Empty searches none. |
| `minLength` | `12` | Shorter values are left alone, except known token formats and the values of the secrets files. |
| `fillCommands` | `true` | Run a Bash command that names `<hidden:NAME>` with the real value. Off, such a command does not run, and the agent is told to read the value inside the command. |

By default the mod reads no `.env` files: the list holds the secrets file, the environment variables, their URL passwords, and the known token formats. To cover your projects' `.env` files too, set `envRoot` to the folder that holds your repos, such as `~/code`. The mod then scans it at start, checks its folders for new `.env` files at most once a minute, and rebuilds the list at least every 10 minutes.

## What it records

`~/.local/state/mods/secret-guard/<day>-<session>.jsonl`: one line each time the list is rebuilt (with how long it took), a result is redacted, a placeholder is restored or filled in a command, or a command is stopped, with secret names and counts only, plus one `session-summary` line. Each line has `at`, `session` and `event`. The values live only in the mod's memory, never on disk.

## Cost

The hook added about 64 ms per tool call on the author's Linux machine (60 calls measured in October 2026, an estimate), with `envRoot` set to a folder of about 140 subfolders, most of it checking whether a source file changed.

## Limits

- A secret shorter than `minLength` that matches no known format stays visible. A value from the secrets file or its folder is hidden from 6 characters, because a vault hands out passwords of 8 to 11; under 6, a value is a PIN or a word, and hiding it would garble ordinary output.
- A secret that the agent already saw before this mod loaded is still in the transcript.
- A `.env` file outside `envRoot` is not read, so its values stay visible unless another source has them.
- The scan skips `node_modules`, `.git`, build output, package caches (`.cache`, `.npm`, `.bun`) and the trash (`Trash`). A `.env` in the caches or build output is not read. The trash gets its own `find` of `.env*` files, run again only when the trash folder's mtime moves, so a trashed worktree's `.env` stays hidden. When `find` worked once and then fails, most often by passing its 30 s on a loaded machine, the last scan stays until the next 10-minute rebuild.
- Filling a placeholder in a command lets the agent use a secret, including sending it to a server. It cannot do more than it already could with `source .env`, but the command runs without a prompt of its own.
- The mod also restores `<oculto:NAME>`, the placeholder an earlier Perl hook wrote.
- The names of the environment come from `/proc/self/environ` on Linux. Elsewhere the mod runs `env -0`, then `env`, then `cmd /c set` (Windows) to read them, in a child that inherits the same environment.
- Placeholders are filled back in Bash commands only. On Windows without Git Bash, a PowerShell command with a placeholder runs as written. Output of every tool is still hidden.
- Tested on Linux only. The macOS and Windows paths are covered by unit tests with a simulated environment.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install secret-guard@cockpit
```

The `cockpit` bundle installs it with the other mods.
