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

None. The skills are read from `<project>/.claude/skills/<name>/SKILL.md`, then `~/.claude/skills/<name>/SKILL.md`. A skill that exists in neither is skipped.

## What it records

`~/.local/state/mods/skill-loader/<day>-<session>.jsonl`: one line per skill loaded, held call, missing skill and reminder, plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

The hook added about 2 ms per tool call on the author's VPS (60 calls measured in October 2026, an estimate). A held write costs the agent one extra call.

## Limits

- Subagents are left alone: a skill delivered there would land in the main conversation.
- The error detection matches common English and Portuguese phrases and stack-trace shapes, so it misses an error described in other words.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install skill-loader@agent
```

The `agent` bundle installs it with the other mods.
