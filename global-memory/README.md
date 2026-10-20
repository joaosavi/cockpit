# global-memory

Adds a machine-wide memory folder beside the per-project auto memory, so facts about the machine reach every session from any folder.

## Why

Claude Code's auto memory is per project. A fact about the machine, such as where a tool lives or how a service is reached, saved in one project's memory is missing from every other project. This mod adds one global folder that every session reads, and tells the agent which memories go there.

## What it does

- Rewrites the memory section of the system prompt to describe both folders and where each type of memory goes: `user` and `feedback` default to global, `reference` goes global when it is about the machine, and `project` always stays in the project.
- Adds the global `MEMORY.md` to the instruction files, so its index reaches every session the way the project index does.
- Keeps core's mode. When memory is read-only, the global folder is described as read-only too. When auto memory is off, or the global folder or its `MEMORY.md` is missing, the mod changes nothing.

## Install it as an organization mod

On a Team or Enterprise plan, the built-in guard `sec-default@builtin` skips mods you install yourself on `prompt.section` and `prompt.context`, the two events this mod needs. List it in `prependPlugins` in managed settings, ahead of the guard, so it counts as your organization's:

```json
{
  "enabledPlugins": { "global-memory@cockpit": true },
  "prependPlugins": ["global-memory@cockpit", "sec-default@builtin"]
}
```

The `cockpit` bundle installs it on every plan. On a personal plan it works as installed; on a Team or Enterprise plan it does nothing until these settings are in place.

## Commands

None.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `enabled` | `true` | Off, the mod does nothing: the memory section stays as Claude Code wrote it. Takes effect in the next session, or after `/reload-plugins`. |
| `globalDir` | `~/.claude/global-memory` | Folder of the machine-wide memory, with its own `MEMORY.md`. |

The mod creates nothing: make the folder and an empty `MEMORY.md` in it, and the mod starts on the next session. `globalDir` can point to a folder inside a git repo, such as `~/dotfiles/memory`, so the memories are versioned and can follow you to another machine.

## What it records

`~/.local/state/mods/global-memory/<day>-<session>.jsonl`: one line each time the memory section is rewritten, the global index is added, or the mod steps aside and why, plus one `session-summary` line. Each line has `at`, `session` and `event`.

## Cost

None per tool call: the mod has no `tool.call` hook. It reads the global `MEMORY.md` when the system prompt and the first context are built. The rewritten text depends only on its input, so the prompt cache stays warm.

## Limits

- The rewrite matches the wording of the memory section Claude Code 2.1.292 sends. A different wording is left alone and logged as `skipped-unrecognized`.
- Every session on the machine reads the global folder. Never save credentials there.
- On Windows without `HOME`, `~` is `USERPROFILE`. Tested on Linux only.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install global-memory@cockpit
```

The `cockpit` bundle installs it with the other mods.
