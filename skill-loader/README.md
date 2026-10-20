# skill-loader

Loads the right skill at the right moment, so `CLAUDE.md` needs no "load skill X before Y" rules.

## Why

A rule in `CLAUDE.md` that says "load this skill before editing that file" works only when the agent remembers it. This mod watches the tool calls and delivers the skill itself.

## What it does

| When the agent | Skill |
| :- | :- |
| Reads or writes a `.ts`, `.tsx`, `.mts` or `.cts` file | `typescript-best-practices` |
| Reads or writes `SKILL.md`, `AGENTS.md` or `CLAUDE.md` | `writing-for-agents` |
| Reads or writes `CONTEXT.md`, `CONTEXT-MAP.md` or a file under `adr/`, `adrs/` or `decisions/` | `domain-modeling` |
| Reads or writes a `README`, or runs `git commit`, `gh pr create` or `gh pr edit` | `technical-writing` |

- On a read, the skill's full text comes with the file. Edit requires a read first, so the skill arrives before the edit.
- On a write without a read (a new file, a commit, a PR), the mod holds the call once, with the skill's text in the refusal, and the agent makes the call again.
- When your prompt carries an error or says something broke, the mod reminds the agent to load `diagnosing-bugs`.

Each skill loads once per conversation. Compaction resets the list, because the summary can drop a skill's text.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `enabled` | `true` | Off, the mod does nothing: no skill is delivered and nothing is held. Takes effect in the next session, or after `/reload-plugins`. |
| `holdWrites` | `true` | Hold a write, a commit or a PR once, with the skill in the refusal, so the agent redoes it following the skill. Off, the call runs and the skill comes with its result. |
| `diagnoseReminder` | `true` | Remind the agent to load `diagnosing-bugs` when your prompt carries an error or says something broke. |

## The skills

The mod ships the five skills it delivers, in its `skills/` folder, so it works with nothing else
installed. Claude Code also lists them as `skill-loader:<name>`. `skills/NOTICE.md` names the source
and license of each.

The mod reads a skill from its own folder first, then from `<project>/.claude/skills/<name>/SKILL.md`,
then from `~/.claude/skills/<name>/SKILL.md`. It finds its own folder through the `installPath` in
`plugins/installed_plugins.json`. Under `--plugin-dir` there is no such record, so only the project's
and the user's folders count.

## What it records

`~/.local/state/mods/skill-loader/<day>-<session>.jsonl`: one line per skill loaded, held call, missing skill and reminder, plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

The hook added about 2 ms per tool call on the author's Linux machine (60 calls measured in October 2026, an estimate). A held write costs the agent one extra call.

## Limits

- Subagents are left alone: a skill delivered there would land in the main conversation.
- The error detection matches common English and Portuguese phrases and stack-trace shapes, so it misses an error described in other words.
- Windows paths with backslashes and `SKILL.md` files with CRLF line ends count the same as their POSIX spelling. Tested on Linux only.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install skill-loader@cockpit
```

The `cockpit` bundle installs it with the other mods.
