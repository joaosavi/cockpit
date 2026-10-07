---
name: setup
description: Set up or reconfigure the agent mods (hud, tip, wtf, rating, secret-guard and the rest) after installing the agent plugin. Use when the user asks to install, set up, configure, restyle or troubleshoot these mods, or when the hud status line or the spinner tip is missing.
---

# Set up the agent mods

Installing `agent@agent` installs the mods and their `/config` options. A few things live outside a plugin's reach, in the user's `~/.claude/settings.json`, and this skill does them. The user picks; you write the settings and prove they work.

The settings file is `$CLAUDE_CONFIG_DIR/settings.json`, or `~/.claude/settings.json` without that variable. Claude Code rewrites it whole, so every edit is a read, a JSON merge of only the keys below, and a write. Copy it to `settings.json.bak-<date>` before the first write.

## 1. Read the starting state

Collect these facts before asking anything:

- `claude --version`, and `node --version`. The hud status line needs Node 22.18 or later and `sh` (on Windows, Git Bash or WSL).
- `claude plugin list`: which `@agent` mods are installed and enabled.
- The marketplace folder: `installLocation` of `agent` in `~/.claude/plugins/known_marketplaces.json`. The status line script is `<installLocation>/mods/hud/statusline/statusline.sh`. Check that the file exists.
- In the settings: `statusLine`, `spinnerTipsEnabled`, `autoCompactWindow`, `enabledPlugins["claude-hud@claude-hud"]`, and `pluginConfigs` entries ending in `@agent`.

Done when you can say, for each section below, what is set today.

## 2. Ask the user

Ask with AskUserQuestion, at most four questions per call, each with a recommended first option. Skip a question the current settings already answer, unless the user asked to change it.

1. **HUD placement.** Under the prompt as the status line (recommended), or above the prompt in the band.
2. **HUD style.** Bar glyphs (`blocks ▰▱`, `solid █░`, `line ━─`, `dots ●○`, `squares ■□`), colors for ok, warning and critical (names, `#rrggbb` or 0-255; default green, yellow, red), and fields to hide (`model`, `project`, `branch`, `age`, `calls`, `ctx`, `5h`, `7d`, `reset`, `mem`). Show a sample row in the option preview.
3. **Time zone** for the `hud`, `audit` and `usage-limit` mods (IANA name; empty uses the system's). The mods have no language option: their text is English, and the model-written lines follow the user's language.
4. **Auto-compact window**, in tokens (`100000` to `1000000`). Claude Code compacts when the conversation reaches the window less a buffer of about 33K tokens. A smaller window compacts earlier, which keeps long sessions sharper and costs more summaries. To compact at 70% of a 1M model, set `733000`. Leave it unset to keep Claude Code's default, about 967K on a 1M model. Check the result with `claude -p /context`: the tokens used plus `Free space` is where compaction runs.

Ask about these only when the user's setup calls for them, or when the user asked:

- `secret-guard`: `secretsFile` (default `~/.secrets`) and `envRoot`, the folder whose `.env` files hold secrets.
- `rating`: `datasetDir` for the ratings dataset, and `configRepo`, the git repo whose settings a rating records.
- `pipefail`: `extraRunners`, script names that run tests besides the usual ones.

## 3. Write the settings

Merge exactly what the user chose:

| Choice | Keys |
| :- | :- |
| HUD under the prompt | `statusLine: { "type": "command", "command": "<installLocation>/mods/hud/statusline/statusline.sh" }` and `pluginConfigs["hud@agent"].options.band: "off"`. If `claude-hud@claude-hud` is enabled, set it to `false`, because its status line is the one replaced. If another status line is set, show it to the user and confirm before you replace it. |
| HUD above the prompt | `pluginConfigs["hud@agent"].options.band: "panel"`. Leave `statusLine` as it is. |
| HUD style | `bar`, `colors` (space-separated), `hide` (comma-separated) under `pluginConfigs["hud@agent"].options` |
| Time zone | `timeZone` under the `hud@agent`, `audit@agent` and `usage-limit@agent` options |
| Spinner tip | `spinnerTipsEnabled: false` whenever `tip@agent` is enabled, so the mod's line replaces Claude Code's tip instead of sitting under it |
| Auto-compact window | top-level `autoCompactWindow: <tokens>` |

Keep every other key and every other plugin's options as they were.

## 4. Prove it works

1. Validate the file: `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' <settings>`.
2. If the status line was set, run it with a sample input and check that two rows print:

	```sh
	echo '{"session_id":"setup","model":{"id":"claude-opus-5-5"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":12,"context_window_size":1000000},"rate_limits":{"five_hour":{"used_percentage":20,"resets_at":'$(( $(date +%s) + 7200 ))'}}}' | COLUMNS=120 <installLocation>/mods/hud/statusline/statusline.sh
	```

3. Tell the user to restart Claude Code. Every `@agent` option can be changed later in `/config`, and the status line picks up a change on its next redraw.

Done when the JSON parses, the status line printed its rows (if it was chosen), and you told the user what changed: each key, its old value and its new value.
