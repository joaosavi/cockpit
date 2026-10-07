// /wtf answers, in a few plain lines, where this session is and what the agent needs from the user,
// for someone who switched between several sessions and remembers nothing about this one.
//
// The answer comes from `$.model.fork`: the session's last request again, with the question after it,
// with no tools and nothing recorded in the conversation, so the agent is not interrupted and the
// answer does not enter its context. The command is immediate, so it also runs mid-turn.
//
// In the terminal and the desktop app the answer opens in a pane; the text reply always comes too,
// for Remote Control, which draws no pane. The diary keeps one line per use with the outcome, the time
// and the tokens the fork spent, never the question or the answer. At the end of each session, one
// summary line counts the uses by outcome and sums their tokens.

import type { Elements, Hook, On, RenderElement } from 'claude-code'
import { addUsage, askedEntry, errorLine, failureLine, NO_USAGE, type Outcome, prompt, question, resultUsage, type Usage } from './rules.ts'
import { countAction, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]
type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Markdown'>

const PANE = 'wtf'

// What the WTF pane draws. The command fills it; the render hook only reads it.
type View = { kind: 'waiting'; question: string } | { kind: 'answer'; question: string; text: string } | { kind: 'failed'; question: string; line: string }
let view: View = { kind: 'waiting', question: '' }

let diary = ''
let cwd = ''
let tally = newTally()
let spent: Usage = NO_USAGE
let forkMs = 0

async function log($: Api, entry: Record<string, unknown>) {
  if (diary === '') return
  let before = ''
  try {
    before = await $.fs.read(diary)
  } catch {
    // first entry of the session
  }
  const line = JSON.stringify({ at: new Date(await $.clock.now()).toISOString(), ...entry })
  await $.fs.write(diary, before + line + '\n')
}

function show($: Api, next: View) {
  view = next
  $.ui.invalidate('ui.render')
}

function pane(ui: Ui, v: View): RenderElement {
  const rows: RenderElement[] = []
  if (v.question !== '') rows.push(ui.Text({ dimColor: true, wrap: 'wrap', children: [`> ${v.question}`] }))
  if (v.kind === 'waiting') rows.push(ui.Text({ dimColor: true, children: ['Lendo a sessão...'] }))
  else if (v.kind === 'answer') rows.push(ui.Markdown({ text: v.text }))
  else rows.push(ui.Text({ children: [v.line] }))
  return ui.Box({ flexDirection: 'column', children: rows })
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

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
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
        description: 'Explains in plain words where this session is and what it needs from you',
        argumentHint: '[question]',
        immediate: true,
      })
    } catch (err) {
      await log($, { event: 'command-refused', error: String(err) })
    }
    return next(e)
  })

  on('command.run', { command: 'wtf' }, async ($, e) => {
    const q = question(e.args)
    const started = await $.clock.now()
    let outcome: Outcome = 'error'
    let used: Usage | null = null
    let text: string
    try {
      show($, { kind: 'waiting', question: q })
      await openPane($)
      const r = await $.model.fork({ prompt: prompt(q) })
      used = resultUsage(r)
      if (r.isAnswered) {
        outcome = 'answered'
        text = r.text.trim()
        show($, { kind: 'answer', question: q, text })
      } else {
        outcome = r.reason
        text = failureLine(r)
        show($, { kind: 'failed', question: q, line: text })
      }
    } catch (err) {
      text = errorLine(err)
      show($, { kind: 'failed', question: q, line: text })
    }
    const ms = (await $.clock.now()) - started
    countAction(tally, outcome)
    spent = addUsage(spent, used)
    forkMs += ms
    try {
      await log($, askedEntry({ hasQuestion: q !== '', outcome, ms, usage: used }))
    } catch {
      // a diary that cannot be written does not hold up the answer
    }
    return { text }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return pane($.ui.resolve(e), view)
  })

  // One summary line per session. `/clear`, `/resume` and `/branch` end a session without reloading the mod.
  on('session.end', async ($, e, next) => {
    const t = tally
    const u = spent
    const ms = forkMs
    tally = newTally()
    spent = NO_USAGE
    forkMs = 0
    const asked = Object.values(t.actions).reduce((a, b) => a + b, 0)
    try {
      await log(
        $,
        sessionSummary(t, e.sessionId, cwd, {
          asked,
          forkMs: Math.round(ms),
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
