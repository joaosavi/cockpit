// Guards the account usage limit before it runs out.
//
// Each window has its own limits: the 5-hour one, and the 7-day ones (per-model weekly windows
// included). Past its throttle stage (5-hour 90%, 7-day 97%), only one subagent runs at a time. Past its
// commit stage (97%, 98%), the agent is asked once per window to commit its work in progress, without
// pushing. At its pause (98%, 99%), the session stops calling tools except a commit, the agent writes
// where it stopped, and the mod schedules the resume for the time the window resets, unless `resume` is
// off. The most restrictive window decides. A prompt the user types during the pause gets one turn
// without subagents, spent from the reserve. An automatic prompt (routine, another session, task
// notification) is held and goes into the resume.
//
// At the end of each session, one summary line in the diary counts the tool calls the mod saw, what it
// held back, and the time its tool.call hook spent outside `next`.

import type { Elements, Hook, On, PluginOptions, RenderElement } from 'claude-code'
import {
  type BandRow,
  bandRows,
  classify,
  commitDue,
  commitKey,
  commitText,
  DEFAULTS,
  droppedText,
  fullest,
  heldText,
  isAutomatic,
  isCommitCommand,
  limitReport,
  msUntilReset,
  type Options,
  options,
  pausedText,
  pauseText,
  reading,
  reserveSubagentText,
  reserveTurnText,
  resumeText,
  showsBand,
  statusText,
  throttledSubagentText,
  type Window,
  withoutExpired,
  type Zone,
} from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

let o: Options = DEFAULTS
let windows: readonly Window[] = []
let zone: Zone = { kind: 'free' }
// The turn the user opened during the pause, which can call any tool except a subagent.
let reserveTurn = false
// Automatic prompts that arrived during the pause.
const queue: string[] = []
let resume: { cancel(): void } | null = null
// The windows, by `commitKey`, for which this conversation was already asked to commit.
const commitAsked = new Set<string>()
let diary = ''
// The subagents this mod let start that have not finished yet. Claude Code's list takes a while to
// show a subagent that was just requested.
const alive = new Set<string>()
let starting = 0
// When the reading in use was taken, by this session or by another one that stored it.
let readAt = 0
let cwd = ''
let tally = newTally()

// The limit belongs to the account, so the last reading from any session applies to all of them.
const KEY = 'windows'

type Api = Parameters<Hook<'session.start'>>[0]

// The tools that run a shell command: Bash, and PowerShell on Windows without Git Bash. A Set of
// strings, since the tool names this version's types list may not include PowerShell.
const COMMAND_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])
type Ui = Pick<Elements['terminal'], 'Box' | 'Text'>

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

function update($: Api, fresh: readonly Window[]) {
  windows = fresh
  const before = zone.kind
  zone = classify(windows, o)
  if (zone.kind === 'paused' && before !== 'paused') countAction(tally, 'paused')
  $.ui.status(statusText(zone, o))
  $.ui.invalidate('ui.render')
}

// One window in the band: name, bar with the pause mark, percent, reset time.
function windowRow(ui: Ui, r: BandRow): RenderElement {
  const cells = r.runs.map((run) =>
    run.kind === 'empty' ? ui.Text({ dimColor: true, children: [run.text] }) : ui.Text({ color: run.kind === 'mark' ? 'error' : r.tone, children: [run.text] }),
  )
  return ui.Box({
    flexDirection: 'row',
    children: [ui.Text({ children: [r.label] }), ...cells, ui.Text({ bold: true, children: [r.percent] }), ui.Text({ dimColor: true, wrap: 'truncate', children: [r.reset] })],
  })
}

async function store($: Api) {
  readAt = await $.clock.now()
  await $.store.set(KEY, { at: readAt, windows })
}

// Takes the reading from another session, if it is newer than this one's.
async function reload($: Api) {
  const r = reading(await $.store.get(KEY), await $.clock.now())
  if (r === null || r.at <= readAt) return
  readAt = r.at
  update($, r.windows)
}

// The window that held the session may have reset without any new response to report it.
async function expire($: Api) {
  if (zone.kind === 'free') return
  const current = withoutExpired(windows, await $.clock.now())
  if (current.length !== windows.length) update($, current)
}

// Schedules a single resume, for the time the full window resets.
async function scheduleResume($: Api, window: Window, reason: string) {
  if (resume !== null) return
  if (!o.resume) {
    await log($, { event: 'resume-off', reason, window })
    return
  }
  const wait = msUntilReset(window, await $.clock.now())
  if (wait === null) {
    await log($, { event: 'no-reset-time', reason, window })
    return
  }
  countAction(tally, 'resume-scheduled')
  await log($, { event: 'resume-scheduled', reason, window, waitMin: Math.round(wait / 60_000) })
  resume = $.clock.after(wait, async () => {
    resume = null
    // The window reset. The right reading arrives with the first response of the resumed turn.
    zone = { kind: 'free' }
    $.ui.status(undefined)
    $.ui.invalidate('ui.render')
    const text = resumeText(window, queue.splice(0))
    countAction(tally, 'resumed')
    await log($, { event: 'resuming' })
    await $.prompt.submit({ text })
  })
}

// The request to commit, once per window, or null when it is not due or was already made.
async function commitRequest($: Api, where: string): Promise<string | null> {
  const due = commitDue(windows, o)
  if (due === null || commitAsked.has(commitKey(due))) return null
  commitAsked.add(commitKey(due))
  countAction(tally, 'commit-asked')
  await log($, { event: 'commit-asked', where, window: due })
  return commitText(due, o)
}

// Runs the tool.call hook's body and adds its own wall time, outside `next`, to the session tally.
// It stays in this file because the hooks loader follows `$` only into functions of the same file.
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

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // One file per session, because `$.fs.write` rewrites the whole file and two sessions sharing one
    // would erase each other's lines. `$.fs.write` creates the folder with the first line.
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/usage-limit/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    const own = (await $.session.usage()).rateLimits
    if (own.length > 0) {
      update($, own)
      await store($)
    } else {
      await reload($)
    }
    $.clock.every(60_000, async () => {
      await reload($)
      await expire($)
    })
    try {
      await $.command.register({ name: 'limit', description: 'Show the usage windows and what is held for the resume', immediate: true })
    } catch (err) {
      await log($, { event: 'command-refused', error: String(err) })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const before = zone.kind
    update($, e.rateLimits)
    await store($)
    if (zone.kind !== before) await log($, { event: 'zone', from: before, to: zone.kind, windows })
    return next(e)
  })

  // The band above the prompt, shared with other mods: their content stays under these rows.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !showsBand(windows, zone, o)) return next(e)
    const ui = $.ui.resolve(e)
    const rows = bandRows(windows, e.props.bodyColumns, o).map((r) => windowRow(ui, r))
    const paused = pausedText(zone, o)
    if (paused !== null) rows.push(ui.Text({ color: 'error', bold: true, wrap: 'truncate', children: [paused] }))
    return ui.Box({ flexDirection: 'column', children: [...rows, await next(e)] })
  })

  on('command.run', { command: 'limit' }, async () => ({
    text: limitReport(windows, zone, o, { isResumeScheduled: resume !== null, held: queue.length }),
  }))

  on('prompt.submit', async ($, e, next) => {
    await expire($)
    // Logs the origin of each prompt, to confirm in real sessions that the user arrives as `bridge`.
    await log($, { event: 'prompt', origin: e.origin.kind, zone: zone.kind })
    if (zone.kind !== 'paused') {
      const ask = await commitRequest($, 'prompt')
      return next(ask === null ? e : { ...e, context: [...(e.context ?? []), ask] })
    }
    if (!isAutomatic(e.origin)) {
      reserveTurn = true
      countAction(tally, 'reserve-turn')
      await log($, { event: 'reserve-turn', origin: e.origin.kind })
      return next({ ...e, context: [...(e.context ?? []), reserveTurnText(zone.window)] })
    }
    if (!o.resume) {
      countAction(tally, 'prompt-dropped')
      await log($, { event: 'prompt-dropped', origin: e.origin.kind })
      return { drop: droppedText() }
    }
    queue.push(e.text)
    countAction(tally, 'prompt-held')
    await log($, { event: 'prompt-held', origin: e.origin.kind })
    await scheduleResume($, zone.window, 'automatic prompt during the pause')
    return { drop: heldText(zone.window, o) }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) reserveTurn = false
    else alive.delete(e.agentId)
    return next(e)
  })

  on('tool.call', async ($, e, next) =>
    timed($, next, async (pass) => {
      await expire($)
      if (zone.kind !== 'paused') {
        // Only the main conversation commits: a subagent would commit half of someone else's work.
        const ask = e.agentId === undefined ? await commitRequest($, 'tool') : null
        if (ask === null) return pass(e)
        const r = await pass(e)
        // A call another mod refused carries no context, so the request waits for the next call.
        if ('deny' in r && r.deny !== undefined) {
          const due = commitDue(windows, o)
          if (due !== null) commitAsked.delete(commitKey(due))
          return r
        }
        return { ...r, context: [...(r.context ?? []), ask] }
      }
      if (reserveTurn) return pass(e)
      const command: unknown = Reflect.get(e, 'command')
      if (COMMAND_TOOLS.has(e.tool) && typeof command === 'string' && isCommitCommand(command)) {
        countAction(tally, 'commit-passed')
        await log($, { event: 'commit-passed', agentId: e.agentId })
        // The turn may end after the commit without any refused call, so the resume is scheduled here too.
        await scheduleResume($, zone.window, 'commit during the pause')
        return pass(e)
      }
      countAction(tally, 'tool-refused')
      await log($, { event: 'tool-refused', tool: e.tool, agentId: e.agentId })
      await scheduleResume($, zone.window, 'work interrupted by the pause')
      return { deny: pauseText(zone.window, o) }
    }),
  )

  on('agent.spawn', async ($, e, next) => {
    await expire($)
    if (zone.kind === 'paused') {
      countAction(tally, 'subagent-refused')
      await log($, { event: 'subagent-refused', reason: 'reserve' })
      return { deny: reserveSubagentText() }
    }
    const list = await $.agent.list()
    for (const a of list) if (a.status !== 'running') alive.delete(a.id)
    // There is no await from here to `starting += 1`: two requests in the same response cannot both pass.
    const running = Math.max(list.filter((a) => a.status === 'running').length, starting + alive.size)
    if (zone.kind === 'throttled' && running > 0) {
      countAction(tally, 'subagent-refused')
      await log($, { event: 'subagent-refused', reason: 'throttled', running })
      return { deny: throttledSubagentText(zone.window, o) }
    }
    starting += 1
    try {
      const r = await next(e)
      const id: unknown = Reflect.get(r, 'agentId')
      if (typeof id === 'string') alive.add(id)
      return r
    } finally {
      starting -= 1
    }
  })

  // `/clear`, `/resume` and `/branch` switch the conversation without reloading the mod. The scheduled
  // resume and the held messages belonged to the previous conversation. One summary line per session.
  on('session.end', async ($, e, next) => {
    resume?.cancel()
    resume = null
    reserveTurn = false
    alive.clear()
    commitAsked.clear()
    const lost = queue.splice(0)
    const t = tally
    tally = newTally()
    try {
      if (lost.length > 0) await log($, { event: 'conversation-switched', reason: e.reason, lost: lost.length })
      await log($, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a diary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    if (Reflect.get(e, 'error') === 'rate_limit') {
      countAction(tally, 'hit-100')
      await log($, { event: 'hit-100', resume: o.resume })
      if (o.resume) {
        const full = fullest((await $.session.usage()).rateLimits)
        if (full !== null) await scheduleResume($, full, 'limit error')
      }
    }
    return next(e)
  })
}
