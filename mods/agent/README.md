# agent

Installs every agent mod at once. Each mod is a dependency of this bundle, so one install brings them all.

## Install

```sh
claude plugin marketplace add joaosavi/claude-devcontainer
claude plugin install agent@agent
```

## The mods

- `usage-limit`: one subagent at a time from 90% of the usage limit, a pause that keeps the last 2% for you, and an automatic resume when the window resets. `/limit`.
- `memory-guard`: keeps typecheck, build, test and Playwright runs under the cgroup memory limit, with one process, a wait, or a refusal, and reruns a command killed with exit 137. `/ram`.
- `skill-loader`: delivers the right skill when the agent touches a file or commits, and reminds it to load diagnosing-bugs when you paste an error.
- `audit`: records every MCP call that writes in a daily file. `/audit`.
- `loop-breaker`: tells the agent to stop and change approach when it goes in circles.
- `secret-guard`: hides every secret value in tool output as `<hidden:NAME>`, and writes the real value back into `.env` files.
- `pipefail`: adds `set -o pipefail;` to a test, typecheck or lint run piped into `tail`, `head` or `grep`.
- `mod-report`: `/mods`, what each mod did and what it cost per tool call.
- `rating`: records every turn as a dataset with your 1-5 ratings and weak labels. `/rate`, `/ratings` and a band above the prompt.
- `wtf`: `/wtf`, a cheap Haiku summary of where the session is and what it needs from you.
- `tip`: replaces the tip under the spinner with one Haiku line: where the session stands, or a tip about these mods. Needs `"spinnerTipsEnabled": false` in settings.

Each mod has its own README with its options, what it records and what it costs.

## Not in the bundle: global-memory

`global-memory` adds a machine-wide memory folder beside the per-project auto memory. On a Team or Enterprise plan the built-in guard skips it unless it runs as an organization mod, listed in `prependPlugins` in managed settings, so it is not a dependency of this bundle. Its README shows the settings. On a personal plan, install it with `claude plugin install global-memory@agent`.

## Where the mods write

Every mod writes its diary under `~/.local/state/mods/<mod>/`. Each diary line has `at`, `session` and `event`, and each session ends with one `session-summary` line that `/mods` reads.
