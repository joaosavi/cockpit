# collision-guard

Warns when two Claude Code sessions on the same machine work on the same files, and holds a git command once when it would take another session's uncommitted edits along.

## Why

Running several sessions at once is common, and two of them often land in the same repo. On the author's Linux machine, 11 pairs of sessions edited the same repo less than 30 minutes apart in 8 days, and 5 of those pairs edited the same file. Claude Code's Edit already refuses a file changed since it was read, so one session does not silently overwrite the other. What it does not catch is git: `git add -A` or `git commit -a` in one session stages the other session's half-done edits, and `git stash`, `checkout` or `reset --hard` moves or discards them.

## What it does

- Each session keeps one record in `~/.local/state/mods/collision-guard/sessions/<session>.json` with the files it edited. Only that session writes it.
- After an edit, when another live session also edited that file and git still shows its change, the agent reads a note naming the session and how long ago, and you see a toast. Outside any git repo, the other edit counts for `windowMinutes`. Each edit of the other session warns once.
- Before a git command that would stage, commit, stash, switch away from or discard another session's uncommitted edits, the mod holds it and lists those files. The agent can name its own files instead, or run the same command again within 2 minutes to let it through.
- It reads `cd` earlier in the line and `git -C <dir>` to find the repo. Quoted text, such as a commit message, is not read as a command.
- A command that names paths, such as `git add -A mods/` or `git checkout -- src/a.ts`, is held only for the other session's edits under those paths. A wildcard or `:/` counts as the whole repo.
- Ended sessions mark their record, and records older than `expireHours` are removed when a session starts.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `git` | `confirm` | `confirm` holds a risky git command once. `note` lets it run and tells the agent afterwards. `off` leaves git commands alone. |
| `windowMinutes` | `30` | How long another session's edit to a file outside any git repo still counts. Inside a repo, an edit counts while git shows the file as changed. |
| `expireHours` | `24` | A session silent this long counts as gone, and its record is removed. |

## What it records

`~/.local/state/mods/collision-guard/<day>-<session>.jsonl`: one line per warning (`edit-warned`, `git-held`, `git-confirmed`, `git-noted`) with the git operation and how many files, never a file's content, plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

A tool call that is neither an edit nor a git command costs nothing measurable. An edit reads the other sessions' records and runs `git rev-parse` once per folder; when another session edited the same file, it also runs `git status` on it. In the first live test, the edit that found a collision took 444 ms of hook time, and the others under 60 ms (7 calls, October 2026).

## Limits

- Sessions must share the machine and the home folder. Sessions on another computer, or in a container with its own home, are not seen.
- A file changed by a Bash command (`sed -i`, a script, a formatter) is not recorded as an edit. Only Edit, Write, MultiEdit and NotebookEdit are.
- `git checkout <name>` reads the same whether `<name>` is a branch or a file, so the note says "to another branch or an older version".
- Tested on Linux only. On Windows, paths are compared with forward slashes, as git prints them, git commands through the PowerShell tool are checked like Bash ones, and the files of ended sessions are deleted with `del` when there is no `rm`. A `cd` to a Git Bash path such as `/c/work` is not followed.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install collision-guard@cockpit
```

The `cockpit` bundle installs it with the other mods.
