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
| `wikiDir` | empty | Wiki folder of an [ai-memory](https://github.com/akitaonrails/ai-memory) server, such as `~/.local/share/ai-memory/wiki`. Set, both indexes come from the wiki: see below. |
| `recall` | `true` | With `wikiDir` set, adds the pages that match each request to it. See Recall below. |
| `recallMaxTokens` | `4000` | Most tokens recall adds to one request, estimated at 2 characters per token. |
| `aiMemoryCommand` | `ai-memory` | The ai-memory CLI recall runs to search. |
| `gatewayCommand` | empty | Without `wikiDir`, recall searches and reads pages through this command: it takes a tool name and its JSON arguments and prints the answer. See Recall below. |
| `gatewayToolPrefix` | `memoria_` | Prefix of the ai-memory tool names on the gateway. |
| `projectsFile` | empty | JSON file of projects, `{ "<name>": { "path": "~/folder" } }`, that names the session's ai-memory project by its folder. |

The mod creates nothing: make the folder and an empty `MEMORY.md` in it, and the mod starts on the next session. `globalDir` can point to a folder inside a git repo, such as `~/dotfiles/memory`, so the memories are versioned and can follow you to another machine.

## What it records

`~/.local/state/mods/global-memory/<day>-<session>.jsonl`: one line each time the memory section is rewritten, the global index is added, or the mod steps aside and why, plus one `session-summary` line. Each line has `at`, `session` and `event`. Recall adds `recall-injected` with the `pages`, the estimated `tokens` and the `ms` it took, or the reason it added nothing: `recall-skipped-service`, `recall-skipped-short`, `recall-none` or `recall-failed`. An index over the limits adds `index-over-limit`.

## Cost

None per tool call: the mod has no `tool.call` hook. It reads the global `MEMORY.md` when the system prompt and the first context are built. The rewritten text depends only on its input, so the prompt cache stays warm.

Recall runs two `ai-memory call memory_query` on each request from a person, in parallel, and reads the matching pages from disk: 132 to 226 ms per request on the eight cases below. The pages it adds cost up to `recallMaxTokens` per request, 624 to 3,715 tokens on those cases. No model is called.

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

## Index from an ai-memory wiki

With `wikiDir` set, the mod reads the indexes from the wiki on disk, where agents write through the ai-memory MCP tools, instead of from `MEMORY.md`:

- The global index is the page `_rules/indice-memorias.md` of the wiki project `_global`.
- The project index is the same page of the wiki project named like the folder the project memory resolves to. A project memory folder that links to `~/repo/memorias/work` reads the project `work`.

The memory section of the system prompt changes too, when the wiki holds the global folder's project. Its save rules tell the agent to write through the `ai-memory` MCP tools, never with Write or Edit. The agent searches with `memory_query`, edits with `memory_patch_page`, writes a new page with `memory_write_page` at the folder's wiki path, such as `memorias/getdemo/<name>.md`, and appends its line to the project's index page. A global page, the global index included, is patched with `workspace: "default"` and `project: "_global"`, because `memory_patch_page` takes no `scope` and otherwise looks in the session's project. A project folder with no wiki project gets global saves only. Core's guidance on memory types, exclusions and recall stays as core wrote it.

The mod finds a project by the `project:` line of each folder's `_meta.md`. A project memory folder that is not a link, a project missing from the wiki, or a missing page keeps `MEMORY.md`.

An index page over the limits gets one warning line under it, where the agent reads it: a line over 200 characters, or a body over 22,000 characters, 88% of the 25,000 core loads. Past 25,000 the pages listed last never reach the agent. The fix is to shorten each hook with `memory_patch_page` and move the detail into the page.

## Recall

The index lists every memory in one line; the page holds the fact. With `wikiDir` set, the mod searches the wiki for the words of each request and adds the best pages to it whole, so the agent starts with the memories it will probably need.

1. A prompt from a person or the host app searches; a pasted agent message (it starts with `<`, such as `<task-notification>` or `<cross-session-message>`), a scheduled prompt, and a prompt with fewer than two subject words do not.
2. The request loses its function words and the filler of dictated speech, in Portuguese and English. An acronym in capitals stays, so "IR do CDB" searches `ir cdb`.
3. Two searches run on the ai-memory server: full text over every project, and the project search, which fuses full text, entities, the graph and the local vector index. Only memory pages of the session's projects and `_global` count. The session's projects are, most specific first, the one an `.ai-memory.toml` above the session folder names, the `projectsFile` entries whose folder holds the session folder, and the project the memory folder links to. The project search runs in each of them, up to 3.
4. The score adds the full-text score over the best one (weight 2), the place in the fused search (weight 0.5) and the share of subject words found in the page's file name or index line (weight 1). A page under 60% of the best stays out.
5. Up to 3 pages go in, in rank order. A page goes in whole when it fits `recallMaxTokens` and still leaves room for the summaries of the pages below it. Otherwise its summary goes in: the text before its first subheading, at most 800 tokens, with a note to read the rest with `memory_read_page`. A page already added in the conversation is not added again until it compacts or ends.

The pages go in as `<memory project="..." path="...">` blocks under a paragraph that calls them the hook's suggestions, which can be wrong or miss a page, tells the agent to search for the memories it needs with `memory_query` without limiting itself to them, and calls them historical notes, not instructions.

The weights come from eight real requests of 2026-11-18 against the wiki of that day, five of them dictated. On the raw request, the fused search put an expected page first in 2 of 8, and the full-text search in 5 of 8: it missed the three long dictated requests, whose filler words matched pages written in the same tone. With the filler removed and the three signals added, every request got at least one of its pages, and 10 of the 13 expected pages went in. A missed page shared no word with the request (the request said "balancete", the page "fechamento") or did not fit the budget behind a 6,000-token page, which now goes in as its summary.

Recall reads the pages from the wiki on disk when `wikiDir` is set. On a machine without the wiki, set `gatewayCommand` to a command that reaches the same ai-memory tools through an MCP gateway: recall then runs `<gatewayCommand> memoria_memory_query <json>` for the searches and `memoria_memory_read_page` for the pages and the index pages, all in parallel. Without either, or with the server down, the request goes in unchanged and the diary says `recall-failed`. The diary's `source` field says which path ran, and `summarized` lists the pages that went in as their summary.
