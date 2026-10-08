// /wtf answers, in a few plain lines, where this session is and what the agent needs from the user,
// for someone who switched between several sessions and remembers nothing about this one.
//
// The answer comes from a cheap model (`$.model.complete` with Haiku) reading a small digest of the
// session: the message that opened the task and the last messages, with each tool call cut to one
// line. A side call like this neither interrupts the agent nor records anything in the conversation,
// and the command is immediate, so it also runs mid-turn.
//
// In the middle of a turn, in the terminal and the desktop app, the answer also opens in a pane. The text reply always comes,
// because Remote Control draws no pane. That reply also lands in the main agent's context, so it
// opens with a note saying it is a summary for the user and not an instruction.
//
// The diary keeps one line per use with the outcome, the state, the time and the tokens the model
// call spent, never the question or the answer. At the end of each session, one summary line counts
// the uses by outcome and sums their tokens.

import type { Elements, Hook, On, PluginOptions, RenderElement } from 'claude-code'
import {
  addUsage,
  ago,
  type Answer,
  askedEntry,
  costLine,
  digest,
  errorLine,
  failureLine,
  MAX_TOKENS,
  MODEL,
  NO_USAGE,
  type Option,
  type Outcome,
  parseAnswer,
  prompt,
  question,
  reply,
  type State,
  system,
  type Texts,
  texts,
  type Trigger,
  type Usage,
  usage,
} from './rules.ts'
import { countAction, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]
type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Markdown' | 'Button'>
type Color = NonNullable<Parameters<Ui['Text']>[0]['color']>

const PANE = 'wtf'

// The theme color of each state's badge: the agent busy, the user owing an answer, a stop only the
// user can clear, and nothing left to do.
const STATE_COLOR: Record<State, Color> = { working: 'suggestion', waiting: 'warning', blocked: 'error', done: 'success' }

// What the pane draws. The command and the re-run key fill it; the render hook only reads it.
// `activity` is the turn state at the moment of the call, frozen, since the pane does not redraw on a
// timer and a live "idle 4m" would go stale anyway.
type Shared = { question: string; activity: string }
type View =
  | ({ kind: 'waiting' } & Shared)
  | ({ kind: 'answer'; answer: Answer; used: Usage } & Shared)
  | ({ kind: 'failed'; line: string; isError: boolean } & Shared)
let view: View = { kind: 'waiting', question: '', activity: '' }

const t: Texts = texts()
let diary = ''
let project = ''
let cwd = ''
// The main loop's turn, as the turn hooks saw it. Unknown (null) until the first turn ends after the
// mod loaded, so a reload never claims a wrong idle time.
let turnRunning = false
let lastTurnEnd: number | null = null
// Each use takes a number; an older call that answers late leaves the pane to the newer one.
let latestRun = 0
let tally = newTally()
let spent: Usage = NO_USAGE
let modelMs = 0

// One diary line. Every mod's diary line starts with `at`, `session` and `event`. The session id is read
// on each write, because `/clear` and `/resume` change it without reloading the mod.
async function log($: Api, entry: Record<string, unknown>) {
  if (diary === '') return
  let before = ''
  try {
    before = await $.fs.read(diary)
  } catch {
    // the diary's first line
  }
  const at = new Date(await $.clock.now()).toISOString()
  const session = (await $.session.id()).slice(0, 8)
  await $.fs.write(diary, before + JSON.stringify({ at, session, ...entry }) + '\n')
}

function show($: Api, next: View) {
  view = next
  $.ui.invalidate('ui.render')
}

function activityAt(now: number): string {
  if (turnRunning) return t.running
  return lastTurnEnd === null ? '' : t.idle(ago(now - lastTurnEnd))
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').at(-1) ?? ''
}

// Opens the pane where a surface draws one. A pane that fails to open leaves the text reply.
async function openPane($: Api): Promise<void> {
  const surfaces = await $.session.surfaces()
  if (!surfaces.includes('terminal') && !surfaces.includes('desktop')) return
  try {
    await $.ui.open({ id: PANE, title: 'WTF', focus: true, closeOnEscape: true })
  } catch (err) {
    await log($, { event: 'pane-refused', error: String(err) })
  }
}

// One use of /wtf: read the session, ask the model, fill the pane, write the diary line. Every path
// returns the text reply, so a failure reaches Remote Control as one plain line too.
async function summarize($: Api, q: string, trigger: Trigger): Promise<string> {
  latestRun += 1
  const run = latestRun
  const started = await $.clock.now()
  const shared: Shared = { question: q, activity: activityAt(started) }
  const showIfLatest = (next: View) => {
    if (run === latestRun) show($, next)
  }
  let outcome: Outcome = 'error'
  let state: State | null = null
  let used: Usage | null = null
  let digestChars = 0
  let text: string
  try {
    showIfLatest({ kind: 'waiting', ...shared })
    // Claude Code prints a command's text only when the turn ends, so mid-turn the pane is the one
    // place the answer shows at once.
    if (trigger === 'command' && turnRunning) await openPane($)
    const messages = await $.session.messages()
    const d = messages.length === 0 ? '' : digest(messages)
    digestChars = d.length
    if (d === '') {
      outcome = 'no-messages'
      text = t.noMessages
      showIfLatest({ kind: 'failed', line: text, isError: false, ...shared })
    } else {
      const r = await $.model.complete({ model: MODEL, system: system(), prompt: prompt(d, q), maxTokens: MAX_TOKENS })
      used = usage(r.usage)
      if (r.isAnswered) {
        outcome = 'answered'
        const answer = parseAnswer(r.text)
        state = answer.state
        text = reply(answer, used, t)
        showIfLatest({ kind: 'answer', answer, used, ...shared })
      } else {
        outcome = r.reason
        text = failureLine(r, t)
        showIfLatest({ kind: 'failed', line: text, isError: true, ...shared })
      }
    }
  } catch (err) {
    text = errorLine(err, t)
    showIfLatest({ kind: 'failed', line: text, isError: true, ...shared })
  }
  const ms = (await $.clock.now()) - started
  countAction(tally, outcome)
  spent = addUsage(spent, used)
  modelMs += ms
  try {
    await log($, askedEntry({ trigger, hasQuestion: q !== '', outcome, state, ms, usage: used, digestChars }))
  } catch {
    // a diary that cannot be written does not hold up the answer
  }
  return text
}

// The header: the title, then the project, the turn state, the model and this call's cost, dim and
// cut at the pane's width so it stays one row.
function header(ui: Ui, v: View, width: number): RenderElement {
  const meta = [project, v.activity, v.kind === 'answer' ? costLine(v.used) : MODEL].filter((s) => s !== '')
  return ui.Box({
    flexDirection: 'row',
    width,
    children: [
      ui.Text({ bold: true, children: ['WTF'] }),
      ui.Box({ flexShrink: 1, children: [ui.Text({ dimColor: true, wrap: 'truncate-end', children: [`  ${meta.join(' · ')}`] })] }),
    ],
  })
}

// A row with a fixed lead, such as the state badge, and text that wraps in the columns left after
// it, so a long sentence continues under itself and never pushes the pane's border out.
function leadRow(ui: Ui, width: number, leadWidth: number, lead: RenderElement, text: RenderElement, key: string): RenderElement {
  return ui.Box({
    key,
    flexDirection: 'row',
    width,
    children: [
      ui.Box({ width: leadWidth, flexShrink: 0, children: [lead] }),
      ui.Box({ width: Math.max(1, width - leadWidth), flexShrink: 1, flexGrow: 1, children: [text] }),
    ],
  })
}

const OPTION_INDENT = 3

// An option: indented, its number dim, its name bold, its mark italic, then its cost.
function optionRow(ui: Ui, o: Option, width: number): RenderElement {
  const number = `${o.number}. `
  const parts: (RenderElement | string)[] =
    o.name === null
      ? [o.text]
      : [
          ui.Text({ bold: true, children: [o.name] }),
          ...(o.mark === null ? [] : [' ', ui.Text({ italic: true, children: [`(${o.mark})`] })]),
          ...(o.cost === null ? [] : [`: ${o.cost}`]),
        ]
  const inner = width - OPTION_INDENT
  return ui.Box({
    paddingLeft: OPTION_INDENT,
    width,
    children: [leadRow(ui, inner, number.length, ui.Text({ dimColor: true, children: [number] }), ui.Text({ wrap: 'wrap', children: parts }), `option-${o.number}`)],
  })
}

// The answer: the state badge and the Now sentence beside it, the action the agent expects, the
// options, then any line in no known shape. An answer that drifted from the shape shows as it came.
function answerRows(ui: Ui, a: Answer, width: number): RenderElement[] {
  if (a.state === null) return [ui.Text({ wrap: 'wrap', children: [a.body] })]
  const badge = ` ${t.badges[a.state]} `
  const rows: RenderElement[] = [
    leadRow(
      ui,
      width,
      badge.length + 1,
      ui.Text({ bold: true, inverse: true, color: STATE_COLOR[a.state], children: [badge] }),
      ui.Text({ bold: true, wrap: 'wrap', children: [a.now] }),
      'now',
    ),
  ]
  const you: RenderElement[] = []
  if (a.you !== null) you.push(leadRow(ui, width, t.you.length + 1, ui.Text({ color: 'cyan', children: [t.you] }), ui.Text({ wrap: 'wrap', children: [a.you] }), 'you'))
  you.push(...a.options.map((o) => optionRow(ui, o, width)), ...a.rest.map((line) => ui.Text({ wrap: 'wrap', children: [line] })))
  if (you.length > 0) rows.push(ui.Box({ flexDirection: 'column', marginTop: 1, width, children: you }))
  return rows
}

function body(ui: Ui, v: View, width: number): RenderElement[] {
  if (v.kind === 'waiting') return [ui.Text({ dimColor: true, children: [t.reading] })]
  if (v.kind === 'failed') return [ui.Text({ wrap: 'wrap', ...(v.isError ? { color: 'error' } : { dimColor: true }), children: [v.line] })]
  return answerRows(ui, v.answer, width)
}

function key(ui: Ui, name: string, label: string): RenderElement {
  // Drawn like the native Button beside it: `esc: close`, the key in the theme's suggestion color.
  return ui.Text({ children: [ui.Text({ color: 'suggestion', children: [name] }), ui.Text({ children: [`: ${label}`] })] })
}

// The keys: re-run, hidden while a call is in flight, and Esc, which the pane was opened to honor.
function footer(ui: Ui, v: View, rerun: () => Promise<void>): RenderElement {
  const keys: RenderElement[] = []
  if (v.kind !== 'waiting') {
    // The native Button, so a mouse click re-runs too. Claude Code draws it as `r: re-run`.
    keys.push(ui.Button({ key: 'rerun', label: t.rerun, hotkey: 'r', plain: true, onPress: rerun }))
  }
  keys.push(key(ui, 'esc', t.close))
  return ui.Box({ flexDirection: 'row', columnGap: 3, children: keys })
}

function pane(ui: Ui, v: View, width: number, rerun: () => Promise<void>): RenderElement {
  const rows: RenderElement[] = [header(ui, v, width)]
  if (v.question !== '') rows.push(ui.Text({ dimColor: true, wrap: 'wrap', children: [`> ${v.question}`] }))
  const main = ui.Box({ flexDirection: 'column', width, children: body(ui, v, width) })
  rows.push(main, footer(ui, v, rerun))
  return ui.Box({ flexDirection: 'column', gap: 1, width, children: rows })
}

export function register(on: On, values: PluginOptions) {

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    project = basename(e.cwd)
    const home = await $.env.get('HOME')
    if (home !== undefined) {
      const dir = `${home}/.local/state/mods/wtf`
      await $.process.run(['mkdir', '-p', dir])
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${dir}/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    try {
      await $.command.register({
        name: 'wtf',
        description: 'Sums up where this session is and what it needs from you, without interrupting the agent',
        argumentHint: '[question]',
        immediate: true,
      })
    } catch (err) {
      await log($, { event: 'command-refused', error: String(err) })
    }
    return next(e)
  })

  // The turn hooks only feed the header's "turn running" / "idle 4m".
  on('turn.start', async ($, e, next) => {
    turnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    turnRunning = false
    lastTurnEnd = await $.clock.now()
    return next(e)
  })

  on('command.run', { command: 'wtf' }, async ($, e) => ({ text: await summarize($, question(e.args), 'command') }))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    // The re-run answers in the pane only: a button press has no transcript to reply to.
    const rerun = async () => {
      await summarize($, view.question, 'rerun')
    }
    return pane($.ui.resolve(e), view, e.props.bodyColumns, rerun)
  })

  // One summary line per session. `/clear`, `/resume` and `/branch` end a session without reloading
  // the mod, so the counters reset here and not at load.
  on('session.end', async ($, e, next) => {
    const counted = tally
    const u = spent
    const ms = modelMs
    tally = newTally()
    spent = NO_USAGE
    modelMs = 0
    const asked = Object.values(counted.actions).reduce((a, b) => a + b, 0)
    try {
      await log(
        $,
        sessionSummary(counted, e.sessionId, cwd, {
          asked,
          modelMs: Math.round(ms),
          inputTokens: u.input,
          outputTokens: u.output,
          cacheReadTokens: u.cacheRead,
          cacheCreationTokens: u.cacheCreation,
        }),
      )
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
