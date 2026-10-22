---
name: setup
description: Set up or reconfigure the Cockpit mods (hud, spinner-status, panel, secret-guard and the rest) after installing the cockpit plugin. Use when the user asks to install, set up, configure, restyle or troubleshoot these mods, or when the hud status line or the spinner tip is missing.
---

# Set up the Cockpit mods

Installing `cockpit@cockpit` installs the mods and their `/config` options. A few things live outside a plugin's reach, in the user's settings file, and this skill does them. The user picks from one round of questions; you write the settings and prove they work.

`<config>` is `$CLAUDE_CONFIG_DIR`, or `~/.claude` without that variable. The settings file is `<config>/settings.json`. Claude Code rewrites it whole, so every edit is a read, a JSON merge of only the keys below, and a write. Copy it to `settings.json.bak-<date>` before the first write.

The person may never have seen the mods. Every question, option and closing line speaks of what they will see on screen, in their language. Setting names (`band`, `statusLine`, `refreshInterval`, `timeZone`, `autoCompactWindow`, `pluginConfigs`) belong in the files, never in what the person reads.

## 1. Read the starting state

Collect these facts in one command, before asking anything:

- `claude --version`, and `node --version`. The hud status line needs Node 22.18 or later. On macOS and Linux it runs through `sh`; on Windows it runs `node` on `statusline.ts` directly, since Claude Code may run the command in PowerShell.
- `claude plugin list`: which `@cockpit` mods are installed and enabled.
- The marketplace entry: `installLocation`, `source` and `autoUpdate` of `cockpit` in `<config>/plugins/known_marketplaces.json`. The status line script is `<installLocation>/hud/statusline/statusline.sh`, and beside it `statusline.ts`. Check that the files exist. On Windows, write `installLocation` with forward slashes wherever it goes into a command: Git Bash drops backslashes.
- In the settings: which mods have `enabled: false`, `extraKnownMarketplaces.cockpit`, `statusLine`, `spinnerTipsEnabled`, `autoCompactWindow`, `enabledPlugins["claude-hud@claude-hud"]`, and `pluginConfigs` entries ending in `@cockpit`.
- The system time zone: `node -e 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)'`.
- The style previews: each style drawn by the real script, with the user's own folder and branch, narrow enough to fit the question's preview box. Run this from the user's working folder:

	```sh
	sh=<installLocation>/hud/statusline/statusline.sh; p=$(mktemp -d); now=$(date +%s)
	for s in refined blocks minimal compact; do
	  printf '{"pluginConfigs":{"hud@cockpit":{"options":{"style":"%s","icons":"unicode"}}}}' $s > $p/settings.json
	  echo "== $s"
	  printf '{"session_id":"setup","model":{"id":"claude-opus-5-5"},"workspace":{"current_dir":"%s"},"context_window":{"used_percentage":38,"context_window_size":1000000},"rate_limits":{"five_hour":{"used_percentage":11,"resets_at":%s},"seven_day":{"used_percentage":59,"resets_at":%s}}}' "$PWD" $((now+15000)) $((now+300000)) \
	    | CLAUDE_CONFIG_DIR=$p COLUMNS=74 $sh | sed 's/\x1b\[[0-9;]*m//g'
	done; rm -rf $p
	```

	On Windows, set `sh="node <installLocation>/hud/statusline/statusline.ts"` instead; the loop needs the Bash tool (Git Bash). Without it, draw the four previews with the same inputs from a short Node script that runs `statusline.ts` once per style.

Done when you can say, for each section below, what is set today, and you hold the four previews.

## 2. Ask the user

Ask the questions in one AskUserQuestion call, each with a recommended first option. Skip a question the current settings already answer, unless the user asked to change it. The questions:

1. **Style** of the status line under the prompt. Options `refined` (recommended), `blocks`, `minimal`, `compact`, each with its preview from step 1, as printed, and a description of a few words: refined has bars, blocks paints each field's background, minimal spells the fields in words, compact is the shortest.
2. **Icons.** You cannot write Nerd Font glyphs yourself: they come out blank. Before the questions, print them with Bash, `printf '\uf418 branch   \uf407 pull request   \U000f06a9 robot\n'`, so the person sees them in the tool output, and ask whether the three symbols in that output show as small icons. Options: "I see three icons" (Nerd Font glyphs) and "I see boxes, question marks or blanks" (plain arrows and marks, which work in every terminal). Recommend the second when unsure.
3. **Time zone**, for the clock times the mods show and for what counts as today. Ask only when the system time zone is `UTC`, `Etc/UTC` or empty; otherwise use the system's and write nothing. Recommend the zone the conversation points to, if any, and let the person type another IANA name as their own answer.
4. **When to compact.** Claude Code summarizes the conversation when it gets close to full, to free room. Options: "Earlier, at about 70% of a 1M model" (recommended, `733000`: long sessions stay sharper, at the cost of more summaries), "Claude Code's default, near the end" (writes nothing; about 967K on a 1M model), "Even earlier, at about half" (`500000`). Skip it when the model's window is under 200K.

Ask about these only when the user asked, or the setup calls for them:

- Placement above the prompt instead of under it. Ask it as part of the confirmation when another status line is already set.
- Bars and colors: `bar` (`dots` `●○`, the default, `blocks` `▰▱`, `solid` `█░`, `line` `━─`, `squares` `■□`), `barColor` (`gradient`, the default, `solid` or `tone`), `colors` for ok, warning and critical, and fields to hide (`model`, `project`, `branch`, `age`, `calls`, `ctx`, `5h`, `7d`, `reset`, `mem`).
- `secret-guard`: `secretsFile` (default `~/.secrets`) and `envRoot`, the folder whose `.env` files hold secrets.
- `pipefail`: `extraRunners`, script names that run tests besides the usual ones.
- Mods to turn off. Each mod has an `enabled` option, and each guard has switches for its own steps (listed in its README). When the user wants a mod off, ask in a second AskUserQuestion call, with `multiSelect` on and every mod a checked box means off: "Guards (1 of 2)" with `secret-guard`, `collision-guard`, `pipefail`, `memory-guard`; "Guards (2 of 2)" with `loop-breaker`, `usage-limit`; "Instruments" with `hud`, `spinner-status`, `panel`, `skill-loader`; "Memory" with `global-memory`, `todo`. Describe each option by what stops: hidden secrets, held git commands, the status line, the session page. Write `enabled: false` for each checked mod, and remove `enabled` for a mod the user turns back on. Turning `hud` off also empties the status line, so leave `statusLine` as it is.

## 3. Write the settings

Merge exactly what the user chose:

| Choice | Keys |
| :- | :- |
| HUD under the prompt (the default) | `statusLine: { "type": "command", "command": "<installLocation>/hud/statusline/statusline.sh", "refreshInterval": 5 }`; on Windows the command is `node <installLocation>/hud/statusline/statusline.ts`, with forward slashes. Then `pluginConfigs["hud@cockpit"].options.band: "off"`. If `claude-hud@claude-hud` is enabled, set it to `false`, because its status line is the one replaced. If another status line is set, show it to the user and confirm before you replace it. |
| HUD above the prompt | `pluginConfigs["hud@cockpit"].options.band: "panel"`. Leave `statusLine` as it is. |
| Style and icons | `style`, and `icons` (`nerd` or `unicode`), under `pluginConfigs["hud@cockpit"].options`; when chosen, `bar`, `barColor`, `colors` (space-separated) and `hide` (comma-separated) |
| Time zone | `timeZone` under the `hud@cockpit` and `usage-limit@cockpit` options |
| Mods turned off | `enabled: false` under `pluginConfigs["<mod>@cockpit"].options`, one per mod the user turned off |
| Spinner tip | `spinnerTipsEnabled: false` whenever `spinner-status@cockpit` is enabled, so the mod's line replaces Claude Code's tip instead of sitting under it |
| When to compact | top-level `autoCompactWindow: <tokens>` |
| Updates (always, no question) | `extraKnownMarketplaces.cockpit: { "source": <the source from known_marketplaces.json, copied exactly>, "autoUpdate": true }`. Claude Code refuses a marketplace whose settings entry names a different source, so copy it as it is. If the entry exists, set only `autoUpdate`. With this on, every mod updates by itself a few minutes after the first message of a session. |

Keep every other key and every other plugin's options as they were.

## 4. Prove it works

1. Validate the file: `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' <settings>`.
2. If the status line was set, run the preview command of step 1 once more with the real settings (no temporary `CLAUDE_CONFIG_DIR`, `COLUMNS=120`, one pass) and check that two rows print in the chosen style.
3. Close with a short message in plain words, in this order: the two rows as the person will see them, in a code block; one line per change, said as what they will notice (the status line under the prompt in the blocks style, times in São Paulo time, the conversation summarized at about 70%, the mod's tip line in place of Claude Code's, updates arriving by themselves); if `panel@cockpit` is enabled, one line that a web page with every session on the machine starts by itself and `/panel` gives its address; where the backup is; restart Claude Code so every change takes effect; to change any of it later, `/config` or `/cockpit:setup` again.

Done when the JSON parses, the status line printed its rows (if it was chosen), and the closing message names each change in plain words and the restart.
