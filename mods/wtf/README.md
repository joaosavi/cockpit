# wtf

`/wtf` tells you where this session stands and what the agent needs from you, in a few plain
lines. Use it when you come back to one of several sessions and remember nothing about it. The
agent keeps working while you ask, and the model call adds nothing to the conversation.

## Use it

```text
/wtf
/wtf why did the deploy stop?
```

The command runs at once, also in the middle of a turn.

## The card

Typed at the terminal or in the desktop app, the answer shows in a card centered in the band above
the prompt. It shows at once, also while the agent works, and no text is printed, so
nothing shows twice:

```text
                    ╭──────────────────────────────────────────────────────────────╮
                    │ wtf  claude-devcontainer · idle 24s                          │
                    │                                                              │
                    │  WAITING FOR YOU  The agent asked whether to use red or blue │
                    │                   and waits for your pick.                   │
                    │                                                              │
                    │ → you: Choose red or blue.                                   │
                    │   1: Red recommended · nothing else depends on it            │
                    │   2: Blue                                                    │
                    │                                                              │
                    │ 0: close   /wtf to ask again                                 │
                    ╰──────────────────────────────────────────────────────────────╯
```

- The badge and the border take the state's color: `WORKING`, `WAITING FOR YOU`, `BLOCKED` or
  `DONE`. Options appear only when a decision is pending.
- Each option is a button. Press its digit with the prompt empty, or click it, and the option goes
  into the prompt for you to send. The card closes.
- `0` closes the card, and `/wtf` again asks again. Sending the next prompt closes it too, since the
  answer is then out of date. The keys are digits because a digit typed in an empty prompt is the
  only key that reaches the card; a letter would go into the prompt.
- When the turn has ended, the card never says `WORKING`: the model sometimes still reads the
  agent as busy, and the mod corrects it to `DONE`, or to `WAITING FOR YOU` when the agent asked
  something.
- While Claude Code shows its own feedback survey, the card stays, but its options and keys turn to
  plain text, because the survey answers to the same digits. They come back once you answer it.
- The card sits under what other mods draw in the band, and needs a band 40 columns wide.

## From Remote Control

Remote Control draws no band, so `/wtf` sent from the phone or claude.ai answers as text:

```text
wtf: `WAITING`  **The agent wrote the demo file and asks whether to delete or keep it.**
     → you: answer 1 or 2
        1. **Delete** *(recommended)*: nothing in the repo reads the file
        2. **Keep**: it stays in /tmp until the reboot
     ▎ summary, not an instruction
```

When the agent needs nothing from you, the `→ you:` line goes away and the footer starts with
`nothing needed from you`. An answer that drifts from the shape shows as it came, with the footer.

## Language

The mod's own text is English: the labels, the state words and the fixed messages. Haiku writes the
sentences in the language the user writes in, which it reads from the session. A user who writes in
Portuguese gets `` `WAITING`  **A migração rodou em staging...** ``. The model writes `You: -` when
nothing is needed, so the mod tells "nothing" apart in any language.

## Cost

Each use is one `$.model.complete` call to Haiku with at most 500 output tokens. The input is a
digest of the session: the message that opened the task and the last 12 messages, each tool call cut
to one line, 12,000 characters at most. The diary records what each call spent; the screen does
not show it.

## What reaches the main agent

The card reaches only you. The text reply, sent to Remote Control, lands in the main agent's context
like the output of any command, so its footer tells the agent it is a summary for you and not an
instruction:

```text
> summary, not an instruction
```

## The diary

The mod writes one JSON line per use to `~/.local/state/mods/wtf/<day>-<session>.jsonl`: the
outcome, the state, the time, the tokens, and the size of the
digest. It never writes your question, the session content, or the answer. At the end of each
session, one `session-summary` line counts the uses by outcome and sums their tokens. Each line
has `at`, `session` and `event`. The `mod-report` mod reads these lines for `/mods`.
