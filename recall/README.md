# recall

Searches the [ai-memory](https://github.com/akitaonrails/ai-memory) server for the words of each request and adds the memory pages that match best to it, whole, as the hook's suggestions. No model is called.

## Why

ai-memory's own hooks capture the session and brief it at start: the handoff, the cross-project profile and, with `[briefing]` in a repository's `.ai-memory.toml`, the project's pinned and `_rules/` pages. They add no page per request. In ai-memory 3.5.0 the `UserPromptSubmit` hook returns context only for the recap after a compaction ("reload context"), the inbox notice and the brief of a project the session moved into. A fact page reaches the agent only when the agent thinks to call `memory_query`. This mod brings it with the request.

## What it does

1. A prompt from a person or the host app searches; a pasted agent message (it starts with `<`, such as `<task-notification>` or `<cross-session-message>`), a scheduled prompt, and a prompt with fewer than two subject words do not.
2. The request loses its function words and the filler of dictated speech, in Portuguese and English. An acronym in capitals stays, so "IR do CDB" searches `ir cdb`.
3. Two searches run on the ai-memory server: full text over every project, and the project search, which fuses full text, entities, the graph and the local vector index. Only memory pages of the session's projects and `_global` count. The session's projects are, most specific first, the one an `.ai-memory.toml` above the session folder names and the `projectsFile` entries whose folder holds the session folder. The project search runs in each of them, up to 3.
4. The score adds the full-text score over the best one (weight 2), the place in the fused search (weight 0.5) and the share of subject words found in the page's file name or title (weight 1). A page under 60% of the best stays out.
5. Up to 3 pages go in, in rank order. A page goes in whole when it fits `recallMaxTokens` and still leaves room for the summaries of the pages below it. Otherwise its summary goes in: the text before its first subheading, at most 800 tokens, with a note to read the rest with `memory_read_page`. A page already added in the conversation is not added again until it compacts or ends.

The pages go in as `<memory project="..." path="...">` blocks under a paragraph that calls them the hook's suggestions, which can be wrong or miss a page, tells the agent to search for the memories it needs with `memory_query` without limiting itself to them, and calls them historical notes, not instructions.

### How it reaches the server

The `ai-memory` CLI (`ai-memory call memory_query`) reaches the server its config names: on the same machine, or through a tunnel to the server's port with the server's token in the data folder. When every search on the CLI fails, recall runs the same calls through `gatewayCommand`, a command that takes a tool name and its JSON arguments and prints the answer, such as an MCP gateway's CLI. The pages are read from the wiki on disk when `wikiDir` is set, and through `memory_read_page` otherwise.

## Options

| Option | Default | Meaning |
| :- | :- | :- |
| `enabled` | `true` | Off, the prompt goes in unchanged. |
| `recallMaxTokens` | `4000` | Most tokens recall adds to one request, estimated at 2 characters per token. |
| `aiMemoryCommand` | `ai-memory` | The ai-memory CLI recall runs. |
| `wikiDir` | empty | Wiki folder of a server on this machine, such as `~/.local/share/ai-memory/wiki`; recall then reads the pages from disk. |
| `gatewayCommand` | empty | The fallback when the CLI fails. |
| `gatewayToolPrefix` | `memoria_` | Prefix of the ai-memory tool names on the gateway. |
| `projectsFile` | empty | JSON file of projects, `{ "<name>": { "path": "~/folder" } }`, that names the session's ai-memory project by its folder. |

## What it records

`~/.local/state/mods/recall/<day>-<session>.jsonl`: `recall-injected` with the `source` (`ai-memory` or `gateway`), the `pages`, the `summarized` pages, the estimated `tokens` and the `ms` it took, or the reason it added nothing: `recall-skipped-service`, `recall-skipped-short`, `recall-none` or `recall-failed`. One `session-summary` line at the end. Each line has `at`, `session` and `event`.

## Cost

Two to four `memory_query` calls on each request from a person, in parallel, and one page read per page added: 120 to 340 ms on the server's machine, 1.4 to 2.5 s through a gateway. The pages cost up to `recallMaxTokens` per request.

## Measured

Eight real requests of 2026-11-18, five of them dictated, against that day's wiki. With the page titles in each page's frontmatter, 11 of the 13 expected pages go in and every request gets at least one, the same as when the names came from a hand-written index. A missed page shares no word with the request (the request said "balancete", the page "fechamento") or ranks below pages that share more words.

## Limits

- Searching needs the ai-memory server, through its CLI or a gateway. Without either, or with the server down, the request goes in unchanged and the diary says `recall-failed`.
- The title is a strong signal: a page titled only by its file name ranks lower when the request uses a word that only its hand-written title had.
- Tested on Linux only.

## Install

```sh
claude plugin marketplace add joaosavi/cockpit
claude plugin install recall@cockpit
```

The `cockpit` bundle installs it with the other mods.
