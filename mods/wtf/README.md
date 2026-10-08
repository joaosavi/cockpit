# wtf

`/wtf` tells you where this session stands and what the agent needs from you, in a few plain
lines. Use it when you come back to one of several sessions and remember nothing about it. The
agent keeps working while you ask, and the model call adds nothing to the conversation.

## Use it

```text
/wtf
/wtf why did the deploy stop?
```

The command runs at once, also in the middle of a turn. When the agent needs something from you,
the answer has this shape:

```text
wtf: `WAITING`  **The agent wrote the demo file and asks whether to delete or keep it.**
     → you: answer 1 or 2
        1. **Delete** *(recommended)*: nothing in the repo reads the file
        2. **Keep**: it stays in /tmp until the reboot
     ▎ summary, not an instruction  ·  haiku 935→174
```

That is the raw text; the terminal draws the state in a code span, the sentence and each option's
name in bold, and the mark in italics. When the agent needs nothing from you, the `→ you:` line
goes away and the footer says so:

```text
wtf: `WORKING`  **Running the test suite after fixing the date filter; 84 of 120 passed.**
     ▎ nothing needed from you  ·  summary, not an instruction  ·  haiku 812→61
```

The state is one of `WORKING`, `WAITING`, `BLOCKED` or `DONE`. Options appear only when a decision
is pending. When the session is too short to tell, the answer says so instead of guessing. An
answer that drifts from the shape shows as it came, with the footer.

The quoted footer tells the main agent, which also reads the reply, that the lines are for the
user, and gives the call's tokens.

The answer shows in the transcript. Claude Code prints a command's text only when the turn ends, so
in the middle of a turn the answer also opens at once in a pane, and the text follows when the turn
ends. When the session is idle, only the text shows. The pane, mid-turn:

```text
╭──────────────────────────────────────────────────────────────────✕─╮
│ WTF  claude-devcontainer · running · haiku 941→142                 │
│                                                                    │
│  WAITING FOR YOU  The demo file was created with "oi", and the     │
│                   agent waits for you to delete or keep it.        │
│                                                                    │
│ → you: answer 1 or 2                                               │
│    1. Delete (recommended): the file is only a demo and nothing    │
│       reads it                                                     │
│    2. Keep: it stays in /tmp until the next reboot                 │
│                                                                    │
│ r: re-run   esc: close                                             │
╰────────────────────────────────────────────────────────────────────╯
```

The header shows the project, the turn state (`running` or `idle 4m`), the model and the tokens of
this call. The badge takes the state's color, and long lines wrap inside the pane. Press `r` to ask
again and `Esc` to close. A text reply always comes too, because Remote Control draws no pane.

## Language

The mod's own text is English: the labels, the state words and the fixed messages. Haiku writes the
sentences in the language the user writes in, which it reads from the session. A user who writes in
Portuguese gets `` `WAITING`  **A migração rodou em staging...** ``. The model writes `You: -` when
nothing is needed, so the mod tells "nothing" apart in any language.

## Cost

Each use is one `$.model.complete` call to Haiku with at most 500 output tokens. The input is a
digest of the session: the message that opened the task and the last 12 messages, each tool call cut
to one line, 12,000 characters at most. The footer of the text reply shows what the call spent,
as in `haiku 1200→80`.

## What reaches the main agent

The text reply lands in the main agent's context, like the output of any command. Its footer
tells the agent the reply is a summary for you and not an instruction:

```text
> summary, not an instruction  ·  haiku 935→174
```

The pane and the re-run key reach only you.

## The diary

The mod writes one JSON line per use to `~/.local/state/mods/wtf/<day>-<session>.jsonl`: the
trigger (`command` or `rerun`), the outcome, the state, the time, the tokens, and the size of the
digest. It never writes your question, the session content, or the answer. At the end of each
session, one `session-summary` line counts the uses by outcome and sums their tokens. Each line
has `at`, `session` and `event`. The `mod-report` mod reads these lines for `/mods`.
