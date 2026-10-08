---
name: setup
description: Set up or reconfigure the agent mods (hud, tip, wtf, rating, secret-guard and the rest) after installing the agent plugin. Use when the user asks to install, set up, configure, restyle or troubleshoot these mods, or when the hud status line or the spinner tip is missing.
---

# Set up the agent mods

Installing `agent@agent` installs the mods and their `/config` options. A few things live outside a plugin's reach, in the user's settings file, and this skill does them. The user picks from one round of questions; you write the settings and prove they work.

`<config>` is `$CLAUDE_CONFIG_DIR`, or `~/.claude` without that variable. The settings file is `<config>/settings.json`. Claude Code rewrites it whole, so every edit is a read, a JSON merge of only the keys below, and a write. Copy it to `settings.json.bak-<date>` before the first write.

The person may never have seen the mods. Every question, option and closing line speaks of what they will see on screen, in their language. Setting names (`band`, `statusLine`, `refreshInterval`, `timeZone`, `autoCompactWindow`, `pluginConfigs`) belong in the files, never in what the person reads.

## 1. Read the starting state

Collect these facts in one command, before asking anything:

- `claude --version`, and `node --version`. The hud status line needs Node 22.18 or later and `sh` (on Windows, Git Bash or WSL).
- `claude plugin list`: which `@agent` mods are installed and enabled.
- The marketplace folder: `installLocation` of `agent` in `<config>/plugins/known_marketplaces.json`. The status line script is `<installLocation>/mods/hud/statusline/statusline.sh`. Check that the file exists.
- In the settings: `statusLine`, `spinnerTipsEnabled`, `autoCompactWindow`, `enabledPlugins["claude-hud@claude-hud"]`, and `pluginConfigs` entries ending in `@agent`.
- The system time zone: `node -e 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)'`.
- The style previews: each style drawn by the real script, with the user's own folder and branch, narrow enough to fit the question's preview box. Run this from the user's working folder:

	```sh
	sh=<installLocation>/mods/hud/statusline/statusline.sh; p=$(mktemp -d); now=$(date +%s)
	for s in refined blocks minimal compact; do
	  printf '{"pluginConfigs":{"hud@agent":{"options":{"style":"%s","icons":"unicode"}}}}' $s > $p/settings.json
	  echo "== $s"
	  printf '{"session_id":"setup","model":{"id":"claude-opus-5-5"},"workspace":{"current_dir":"%s"},"context_window":{"used_percentage":38,"context_window_size":1000000},"rate_limits":{"five_hour":{"used_percentage":11,"resets_at":%s},"seven_day":{"used_percentage":59,"resets_at":%s}}}' "$PWD" $((now+15000)) $((now+300000)) \
	    | CLAUDE_CONFIG_DIR=$p COLUMNS=74 $sh | sed 's/\x1b\[[0-9;]*m//g'
	done; rm -rf $p
	```

Done when you can say, for each section below, what is set today, and you hold the four previews.

## 2. Ask the user

Ask the questions in one AskUserQuestion call, each with a recommended first option. Skip a question the current settings already answer, unless the user asked to change it. The call holds at most four, so when the time zone question is needed too, ask it alone in a second call. The questions:

1. **Style** of the status line under the prompt. Options `refined` (recommended), `blocks`, `minimal`, `compact`, each with its preview from step 1, as printed, and a description of a few words: refined has bars, blocks paints each field's background, minimal spells the fields in words, compact is the shortest.
2. **Icons.** Put the three Nerd Font glyphs in the question itself, `` (branch), `` (pull request) and `󰚩` (robot), and ask whether they show as three small icons. Options: "I see three icons" (Nerd Font glyphs) and "I see boxes, question marks or blanks" (plain arrows and marks, which work in every terminal). Recommend the second when unsure.
3. **Time zone**, for the clock times the mods show and for what counts as today. Ask only when the system time zone is `UTC`, `Etc/UTC` or empty; otherwise use the system's and write nothing. Recommend the zone the conversation points to, if any, and let the person type another IANA name in "Other".
4. **When to compact.** Claude Code summarizes the conversation when it gets close to full, to free room. Options: "Earlier, at about 70% of a 1M model" (recommended, `733000`: long sessions stay sharper, at the cost of more summaries), "Claude Code's default, near the end" (writes nothing; about 967K on a 1M model), "Even earlier, at about half" (`500000`). Skip it when the model's window is under 200K.
5. **Where to keep the ratings.** The rating mod saves each answer, its score and its signals to a folder, for reviewing with `/ratings` later. Options: "In `~/datasets/agent-ratings`" (recommended, the default, writes nothing), "In a folder I choose" (the person types the path in "Other"; suggest a git repo they back up, since the files hold prompts and answers in plain text), "Don't keep ratings" (turns the rating mod off). Create the chosen folder with `mkdir -p`.

Ask about these only when the user asked, or the setup calls for them:

- Placement above the prompt instead of under it. Ask it as part of the confirmation when another status line is already set.
- Bars and colors: `bar` (`dots` `●○`, the default, `blocks` `▰▱`, `solid` `█░`, `line` `━─`, `squares` `■□`), `barColor` (`gradient`, the default, `solid` or `tone`), `colors` for ok, warning and critical, and fields to hide (`model`, `project`, `branch`, `age`, `calls`, `ctx`, `5h`, `7d`, `reset`, `mem`).
- `secret-guard`: `secretsFile` (default `~/.secrets`) and `envRoot`, the folder whose `.env` files hold secrets.
- `rating`: `configRepo`, the git repo whose settings a rating records.
- `pipefail`: `extraRunners`, script names that run tests besides the usual ones.

## 3. Write the settings

Merge exactly what the user chose:

| Choice | Keys |
| :- | :- |
| HUD under the prompt (the default) | `statusLine: { "type": "command", "command": "<installLocation>/mods/hud/statusline/statusline.sh", "refreshInterval": 5 }` and `pluginConfigs["hud@agent"].options.band: "off"`. If `claude-hud@claude-hud` is enabled, set it to `false`, because its status line is the one replaced. If another status line is set, show it to the user and confirm before you replace it. |
| HUD above the prompt | `pluginConfigs["hud@agent"].options.band: "panel"`. Leave `statusLine` as it is. |
| Style and icons | `style`, and `icons` (`nerd` or `unicode`), under `pluginConfigs["hud@agent"].options`; when chosen, `bar`, `barColor`, `colors` (space-separated) and `hide` (comma-separated) |
| Time zone | `timeZone` under the `hud@agent`, `audit@agent` and `usage-limit@agent` options |
| Spinner tip | `spinnerTipsEnabled: false` whenever `tip@agent` is enabled, so the mod's line replaces Claude Code's tip instead of sitting under it |
| When to compact | top-level `autoCompactWindow: <tokens>` |
| Ratings folder | `datasetDir` under `pluginConfigs["rating@agent"].options` for a folder they chose; `enabledPlugins["rating@agent"]: false` for no ratings |

Keep every other key and every other plugin's options as they were.

## 4. Prove it works

1. Validate the file: `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' <settings>`.
2. If the status line was set, run the preview command of step 1 once more with the real settings (no temporary `CLAUDE_CONFIG_DIR`, `COLUMNS=120`, one pass) and check that two rows print in the chosen style.
3. Close with a short message in plain words, in this order: the two rows as the person will see them, in a code block; one line per change, said as what they will notice (the status line under the prompt in the blocks style, times in São Paulo time, the conversation summarized at about 70%, the mod's tip line in place of Claude Code's); where the backup is; restart Claude Code so every change takes effect; to change any of it later, `/config` or `/agent:setup` again.

Done when the JSON parses, the status line printed its rows (if it was chosen), and the closing message names each change in plain words and the restart.
