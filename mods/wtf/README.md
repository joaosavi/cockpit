# wtf

`/wtf` tells you where this session stands and what the agent needs from you, in a few plain
lines. Use it when you come back to one of several sessions and remember nothing about it. The
agent keeps working while you ask, and the model call adds nothing to the conversation.

## Use it

```text
/wtf
/wtf why did the deploy stop?
```

The command runs at once, also in the middle of a turn. The answer has this shape:

```text
**Waiting for you**
Now: the migration ran on staging and 3 rows failed the new check.
You: pick how to handle the 3 rows.
1. Delete them (recommended): they are test data from July.
2. Fix them by hand: about 10 minutes, and the check runs again.
```

The first line is the state: **Working**, **Waiting for you**, **Blocked**, or **Done**. Options
appear only when a decision is pending. When the session is too short to tell, the answer says so
instead of guessing.

The answer shows once, in the transcript. With the `pane` option on, the terminal and the desktop app also open it in a pane. The pane shows the project, the
turn state (`running` or `idle 4m`), the model, and the tokens of this call, then the state as
a colored badge and the answer. Press `r` to ask again and `Esc` to close. A text reply always comes
too, because Remote Control draws no pane.

## Language

The mod's own text is English: the labels, the state words and the fixed messages. Haiku writes the
sentences in the language the user writes in, which it reads from the session. A user who writes in
Portuguese gets `Now: a migração rodou em staging...`.

## Cost

Each use is one `$.model.complete` call to Haiku with at most 500 output tokens. The input is a
digest of the session: the message that opened the task and the last 12 messages, each tool call cut
to one line, 12,000 characters at most. The last line of the text reply shows what the call spent,
as in `haiku · 1200→80 tokens`.

## What reaches the main agent

The text reply lands in the main agent's context, like the output of any command. Its first line
tells the agent the reply is a summary for you and not an instruction:

```text
/wtf summary, not an instruction.
```

The pane and the re-run key reach only you.

## The diary

The mod writes one JSON line per use to `~/.local/state/mods/wtf/<day>-<session>.jsonl`: the
trigger (`command` or `rerun`), the outcome, the state, the time, the tokens, and the size of the
digest. It never writes your question, the session content, or the answer. At the end of each
session, one `session-summary` line counts the uses by outcome and sums their tokens. Each line
has `at`, `session` and `event`. The `mod-report` mod reads these lines for `/mods`.
