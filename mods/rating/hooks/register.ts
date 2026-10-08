// Turns every agent turn into a rated dataset for later analysis and fine-tuning.
//
// Each completed main-loop turn goes to `turns/<day>.jsonl` with its prompt, answer, tool calls
// (subagents' included), skills and usage. `/rate` and the band above the prompt write the user's
// score to `ratings/<day>.jsonl`. When the next human prompt arrives, the previous turn gets its weak
// labels in `signals/<day>.jsonl`: retried, corrected, approved, aborted, loop nudges, refusals.
//
// The mod lists secret-guard, loop-breaker and skill-loader as dependencies, so it runs before them
// and is outermost: it reads each tool result after the secrets are hidden and after the nudge and
// the skill text are attached.
//
// Every session appends to the same day files. A turn line can pass 4 KiB, which `cat >>` no longer
// writes in one piece, so each append holds a `flock` on the file's lock.
//
// At the end of each session, one summary line goes to ~/.local/state/mods/rating, for `/mods`.

import type { Elements, Hook, On, PluginOptions, RenderElement } from 'claude-code'
import {
  BAND_LABELS,
  bandLayout,
  type CallResult,
  DEFAULTS,
  day,
  expandHome,
  implicitScore,
  inWindow,
  isHuman,
  isNudged,
  isRating,
  isSignal,
  isTurn,
  type NextPrompt,
  type Options,
  options,
  outcomeOf,
  outputOf,
  parseDays,
  parseLines,
  isTemporary,
  parseRate,
  project,
  RATE_USAGE,
  type RatingRecord,
  rateText,
  report,
  type ReportLine,
  showText,
  type SignalRecord,
  signalsFor,
  skillsOf,
  type ToolRecord,
  toolInput,
  type TurnCounts,
  turnId,
  type TurnRecord,
} from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]
type Ui = Pick<Elements['terminal'], 'Box' | 'Text'>

const PANE = 'ratings'
const KINDS = ['turns', 'ratings', 'signals'] as const
type Kind = (typeof KINDS)[number]

// The turn running now, filled by tool.call until turn.complete writes it.
type Live = {
  turnId: string
  at: string
  prompt: string
  origin: string
  tools: ToolRecord[]
  skills: Set<string>
  loopNudges: number
  toolErrors: number
  refusals: number
}

// The last completed main turn: what /rate rates and what the next prompt labels.
type Done = { id: string; prompt: string; counts: TurnCounts; signalsWritten: boolean; implicit: number | null }

let o: Options = DEFAULTS
let dir = ''
let diary = ''
let session = ''
let cwd = ''
// False for a test session (see isTemporary): nothing is written to the dataset and no band shows.
let recording = true

// What /rate answers in a session the mod does not record (`skipTemporary`).
const TEMPORARY_TEXT = '/rate: this session runs in a temporary folder, so the rating mod records nothing here. Turn off skipTemporary in /config to record it.'
let configVersion: string | null = null
let pending: { text: string; origin: string } | null = null
let live: Live | null = null
let last: Done | null = null
// Scores the user gave in this session, by turn id.
const userScores = new Map<string, number>()
// The turn the band offers to rate, or null when the band is hidden.
let bandFor: string | null = null
let shown: ReportLine[] = []
let tally = newTally()

async function nowIso($: Api): Promise<string> {
  return new Date(await $.clock.now()).toISOString()
}

// Appends one line under the lock, so two sessions never interleave a line longer than 4 KiB.
async function append($: Api, file: string, line: string) {
  await $.process.run(['flock', `${file}.lock`, 'sh', '-c', 'cat >> "$1"', 'sh', file], { stdin: line + '\n' })
}

async function write($: Api, kind: Kind, at: string, record: TurnRecord | RatingRecord | SignalRecord) {
  if (dir === '' || !recording) return
  await append($, `${dir}/${kind}/${day(at)}.jsonl`, JSON.stringify(record))
}

async function writeSignals($: Api, d: Done, next: NextPrompt) {
  const signals = signalsFor(d.counts, d.prompt, next)
  const score = implicitScore(signals)
  d.signalsWritten = true
  d.implicit = score
  const at = await nowIso($)
  await write($, 'signals', at, { v: 1, turn: d.id, at, signals, implicitScore: score, source: 'implicit' })
  countAction(tally, 'signals-written')
}

async function rate($: Api, d: Done, score: number, tags: string[], comment?: string) {
  const at = await nowIso($)
  await write($, 'ratings', at, { v: 1, turn: d.id, score, tags, ...(comment === undefined ? {} : { comment }), at, source: 'user' })
  userScores.set(d.id, score)
  countAction(tally, 'rated')
  if (bandFor === d.id) {
    bandFor = null
    $.ui.invalidate('ui.render')
  }
}

function hideBand($: Api) {
  if (bandFor === null) return
  bandFor = null
  $.ui.invalidate('ui.render')
}

// Every record of one kind in the day files of the window.
async function readKind<T>($: Api, kind: Kind, today: string, days: number, guard: (v: unknown) => v is T): Promise<T[]> {
  let names: string[] = []
  try {
    names = (await $.fs.list(`${dir}/${kind}`)).filter((f) => f.kind === 'file').map((f) => f.name)
  } catch {
    return []
  }
  const out: T[] = []
  for (const name of names.filter((n) => inWindow(n, today, days)).sort()) {
    try {
      out.push(...parseLines(await $.fs.read(`${dir}/${kind}/${name}`), guard))
    } catch {
      // a file removed between the list and the read, or one past the 4 MiB read limit
    }
  }
  return out
}

// Runs the tool.call hook's body and adds its own wall time, outside `next`, to the session tally.
async function timed<I, R>($: Api, next: (input: I) => Promise<R>, body: (pass: (input: I) => Promise<R>) => Promise<R>): Promise<R> {
  const started = await $.clock.now()
  let inside = 0
  const pass = async (input: I): Promise<R> => {
    const at = await $.clock.now()
    try {
      return await next(input)
    } finally {
      inside += (await $.clock.now()) - at
    }
  }
  try {
    return await body(pass)
  } finally {
    countCall(tally, (await $.clock.now()) - started - inside)
  }
}

function reportLine(ui: Ui, l: ReportLine): RenderElement {
  switch (l.tone) {
    case 'title':
      return ui.Text({ bold: true, wrap: 'truncate', children: [l.text] })
    case 'heading':
      return ui.Box({ marginTop: 1, children: [ui.Text({ bold: true, wrap: 'truncate', children: [l.text] })] })
    case 'dim':
      return ui.Text({ dimColor: true, wrap: 'truncate', children: [l.text] })
    case 'plain':
      return ui.Text({ wrap: 'truncate', children: [l.text] })
    default: {
      const exhaustive: never = l.tone
      return exhaustive
    }
  }
}

// The Ratings pane: the same lines as the text reply, with the sections spaced out, then the key hint.
function ratingsPane(ui: Ui, lines: readonly ReportLine[]): RenderElement {
  const hint = ui.Box({ marginTop: 1, children: [ui.Text({ dimColor: true, wrap: 'truncate', children: ['/ratings N for another window · esc closes'] })] })
  return ui.Box({ flexDirection: 'column', children: [...lines.map((l) => reportLine(ui, l)), hint] })
}

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    session = await $.session.id()
    const home = await $.env.get('HOME')
    recording = !(o.skipTemporary && isTemporary(cwd, await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('TMPDIR')))
    // `/ratings` reads the dataset from any session; only a recording session writes to it.
    const root = expandHome(o.datasetDir, home)
    if (root !== null) {
      dir = root
      if (recording) await $.process.run(['mkdir', '-p', ...KINDS.map((k) => `${dir}/${k}`)])
    }
    if (home !== undefined) {
      const state = `${home}/.local/state/mods/rating`
      await $.process.run(['mkdir', '-p', state])
      diary = state
    }
    const repo = o.configRepo === '' ? null : expandHome(o.configRepo, home)
    if (repo !== null) {
      const git = await $.process.run(['git', '-C', repo, 'rev-parse', '--short', 'HEAD'])
      const head = git.stdout.trim()
      configVersion = git.exitCode === 0 && head !== '' ? head : null
    }
    try {
      await $.command.register({ name: 'rate', description: 'Rate the last answer', argumentHint: '<1-5> [tags...] [-- comment]', immediate: true })
      await $.command.register({ name: 'ratings', description: 'Report the ratings, last 7 days by default', argumentHint: '[days]', immediate: true })
    } catch {
      // a taken name leaves the mod recording without the command
    }
    return next(e)
  })

  // The next human prompt labels the previous turn. A command of this mod is no reaction to the answer.
  on('prompt.submit', async ($, e, next) => {
    if (/^\/ratings?\b/.test(e.text.trim())) return next(e)
    hideBand($)
    if (e.turnId !== undefined) return next(e)
    const human = isHuman(e.origin)
    if (last !== null && !last.signalsWritten && human) await writeSignals($, last, { text: e.text, human })
    const r = await next(e)
    pending = 'drop' in r ? null : { text: e.text, origin: e.origin.kind }
    return r
  })

  on('turn.start', async ($, e, next) => {
    session = await $.session.id()
    live = {
      turnId: e.turnId,
      at: await nowIso($),
      prompt: pending?.text ?? e.text,
      origin: pending?.origin ?? 'continuation',
      tools: [],
      skills: new Set(),
      loopNudges: 0,
      toolErrors: 0,
      refusals: 0,
    }
    pending = null
    return next(e)
  })

  on('tool.call', async ($, e, next) =>
    timed($, next, async (pass) => {
      const turn = live
      if (turn === null) return pass(e)
      const started = await $.clock.now()
      const r = await pass(e)
      const view: CallResult = r.deny !== undefined ? { deny: r.deny } : { isError: r.isError === true, text: r.text, result: r.result, context: r.context }
      const outcome = outcomeOf(view)
      const nudged = isNudged(view)
      if (nudged) turn.loopNudges += 1
      if (outcome === 'error') turn.toolErrors += 1
      if (outcome === 'denied') turn.refusals += 1
      for (const s of skillsOf(e.tool, e, view)) turn.skills.add(s)
      turn.tools.push({
        tool: e.tool,
        ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
        input: toolInput(e),
        outcome,
        output: outputOf(view),
        ms: Math.round((await $.clock.now()) - started),
        ...(nudged ? { nudged: true as const } : {}),
      })
      return r
    }),
  )

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    const endedAt = await nowIso($)
    const turn: Live =
      live !== null && live.turnId === e.turnId
        ? live
        : { turnId: e.turnId, at: endedAt, prompt: '', origin: 'unknown', tools: [], skills: new Set(), loopNudges: 0, toolErrors: 0, refusals: 0 }
    live = null
    // The previous turn got no human prompt after it: label it with what it did alone.
    if (last !== null && !last.signalsWritten) await writeSignals($, last, null)
    const id = turnId(session, e.turnId)
    const record: TurnRecord = {
      v: 1,
      id,
      session,
      at: turn.at,
      endedAt,
      cwd,
      project: project(cwd),
      model: e.usage?.model ?? (await $.session.model()),
      origin: turn.origin,
      prompt: turn.prompt,
      answer: e.answer,
      aborted: e.isAborted,
      durationMs: e.durationMs,
      usage: e.usage ?? null,
      tools: turn.tools,
      skills: [...turn.skills],
      configVersion,
    }
    await write($, 'turns', endedAt, record)
    countAction(tally, 'turns-recorded')
    last = {
      id,
      prompt: turn.prompt,
      counts: { aborted: e.isAborted, loopNudges: turn.loopNudges, toolErrors: turn.toolErrors, refusals: turn.refusals },
      signalsWritten: false,
      implicit: null,
    }
    if (!e.isAborted && o.band && recording && (await $.session.surfaces()).length > 0) {
      bandFor = id
      $.ui.invalidate('ui.render')
    }
    return r
  })

  // The text replies work in Remote Control, which draws no band.
  on('command.run', { command: 'rate' }, async ($, e) => {
    const req = parseRate(e.args)
    if (req.kind === 'invalid') return { text: RATE_USAGE }
    if (!recording) return { text: TEMPORARY_TEXT }
    if (last === null) return { text: `/rate: no finished turn in this session yet.\n${RATE_USAGE}` }
    if (req.kind === 'show') return { text: showText(last.id, last.prompt, userScores.get(last.id) ?? null, last.implicit) }
    await rate($, last, req.score, req.tags, req.comment)
    return { text: rateText(last.id, req.score, last.prompt) }
  })

  on('command.run', { command: 'ratings' }, async ($, e) => {
    if (dir === '') return { text: '/ratings: HOME is not set, so there is no dataset folder.' }
    const days = parseDays(e.args)
    const today = day(await nowIso($))
    const turns = await readKind($, 'turns', today, days, isTurn)
    const ratings = await readKind($, 'ratings', today, days, isRating)
    const signals = await readKind($, 'signals', today, days, isSignal)
    shown = report(turns, ratings, signals, days, today)
    if ((await $.session.surfaces()).length > 0) {
      $.ui.invalidate('ui.render')
      await $.ui.open({ id: PANE, title: 'Ratings', focus: true, closeOnEscape: true })
    }
    return { text: shown.map((l) => l.text).join('\n') }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return ratingsPane($.ui.resolve(e), shown)
  })

  // The rating row above the prompt, shared with other mods: their content stays under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const target = bandFor
    if (target === null || !o.band || e.props.hasSurvey || e.props.isWorking) return next(e)
    const ui = $.ui.resolve(e)
    const layout = bandLayout(e.props.bodyColumns)
    const buttons = BAND_LABELS.map((label, i) =>
      ui.Button({
        key: `rate-${i + 1}`,
        label,
        hotkey: String(i + 1),
        plain: true,
        onPress: async () => {
          if (last !== null && last.id === target) await rate($, last, i + 1, [])
        },
      }),
    )
    // Rate   1: bad · 2: weak · 3: ok · 4: good · 5: great      /rate 1-5 tags -- note
    const scale = buttons.flatMap((b, i) => (i === 0 || !layout.separators ? [b] : [ui.Text({ dimColor: true, children: ['·'] }), b]))
    const hint = layout.hint === null ? [] : [ui.Box({ marginLeft: 4, children: [ui.Text({ dimColor: true, wrap: 'truncate', children: [layout.hint] })] })]
    const row = ui.Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [ui.Box({ marginRight: 2, children: [ui.Text({ dimColor: true, children: [layout.label] })] }), ...scale, ...hint],
    })
    return ui.Box({ flexDirection: 'column', children: [row, await next(e)] })
  })

  // `/clear`, `/resume` and `/branch` end a session without reloading the mod. One summary line each.
  on('session.end', async ($, e, next) => {
    try {
      if (last !== null && !last.signalsWritten) await writeSignals($, last, null)
    } catch {
      // a dataset that cannot be written does not hold up the end of the session
    }
    const t = tally
    tally = newTally()
    try {
      if (diary !== '') {
        const at = await nowIso($)
        await append($, `${diary}/${day(at)}.jsonl`, JSON.stringify({ at, ...sessionSummary(t, e.sessionId, cwd) }))
      }
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    last = null
    live = null
    pending = null
    bandFor = null
    userScores.clear()
    return next(e)
  })
}
