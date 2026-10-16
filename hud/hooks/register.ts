// A heads-up display: model, project and branch, context and plan limits, memory headroom, under
// the prompt through the status line script, or above it in the band; and while a turn runs, the
// tool in flight, the subagents and the turn's figures in the band. `/hud`
// opens the full view in a pane, or answers in text where nothing draws (Remote Control).
//
// The band's render hook does no I/O: events and timers read into module state, and the hook lays
// that state out. Redraws follow changes: a usage measure, a tool starting or ending, the subagent
// list changing, the 1 s tick that runs only during a turn, and a 15 s light refresh of memory and
// git that redraws only when what it shows changed.

import type { Elements, Hook, On, PluginOptions, RenderElement, Timer } from 'claude-code'
import {
  type Activity,
  activityRows,
  basename,
  countToday,
  DEFAULTS,
  type DiaryFile,
  expandHome,
  type Git,
  groups,
  inactiveFile,
  LABEL_WIDTH,
  type Level,
  lineRow,
  localDay,
  MAC_PAGES_COMMAND,
  MAC_TIMEOUT_MS,
  MAC_TOTAL_COMMAND,
  type Machine,
  MACHINE_TTL_MS,
  macMemory,
  macTotal,
  mayHoldToday,
  type Memory,
  MEMORY_MARGIN,
  memory,
  meminfo,
  modelName,
  notableOf,
  numberOrMax,
  type Options,
  options,
  type PaneData,
  paneSections,
  paneText,
  panelRows,
  parseGit,
  type Row,
  type RunningAgent,
  type RunningTool,
  type Section,
  type Snapshot,
  type Style,
  styleOf,
  type Today,
  TODAY_MODS,
  toolDetail,
  toolName,
  type Window,
  WINDOWS_COMMAND,
  WINDOWS_TIMEOUT_MS,
  windowsMemory,
} from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]
type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const PANE = 'hud'
const LIGHT_MS = 15_000
const TICK_MS = 1000
const PANE_MS = 2000
const GIT_TIMEOUT_MS = 3000
// Session start times older than this are dropped from the store.
const KEEP_STARTS_MS = 3 * 86_400_000

let o: Options = DEFAULTS
let style: Style = styleOf(DEFAULTS)
let cwd = ''
let home: string | undefined
let diary = ''
// The live file the status line script reads: `~/.local/state/mods/hud/live/<session>.json`.
let liveFile = ''
let tally = newTally()

// What the band draws. Only events and timers write these.
let now = 0
let model: string | null = null
let git: Git | null = null
let startedAt: number | null = null
let calls = 0
let context: number | null = null
let windows: readonly Window[] = []
let mem: Memory | null = null

// The turn in flight, or null when idle.
type Turn = { startedAt: number; calls: number; errors: number; notable: string | null }
let turn: Turn | null = null
const tools = new Map<string, RunningTool>()
const agents = new Map<string, RunningAgent>()
let toolSeq = 0
let tick: Timer | null = null

// The pane, and the diaries it already read, by path and size.
let paneTimer: Timer | null = null
let today: Today | null = null
const fileCache = new Map<string, { size: number; text: string }>()

// What the last light refresh showed, so it redraws only on a change.
let shownKey = ''
let renders = 0
let maxRenderMs = 0

// The diary file for this load of the mod, as summary.ts names it:
// `~/.local/state/mods/hud/<day>-<session8>.jsonl`, or '' without HOME. The validator follows `$` only
// into functions of this file, so the diary helpers of summary.ts are written out here.
async function sessionDiary($: Api): Promise<string> {
  if (home === undefined || home === '') return ''
  const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
  return `${home}/.local/state/mods/hud/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
}

async function log($: Api, entry: Record<string, unknown>) {
  if (diary === '') return
  try {
    let before = ''
    try {
      before = await $.fs.read(diary)
    } catch {
      // the diary's first line
    }
    const at = new Date(await $.clock.now()).toISOString()
    const session = (await $.session.id()).slice(0, 8)
    await $.fs.write(diary, before + JSON.stringify({ at, session, ...entry }) + '\n')
  } catch {
    // a diary that cannot be written never stops the display
  }
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

function snapshot(): Snapshot {
  return { now, timeZone: o.timeZone, model, project: cwd === '' ? null : basename(cwd), git, startedAt, calls, context, windows, memory: o.memory ? mem : null, style }
}

function activity(): Activity | null {
  if (turn === null) return null
  const tool = [...tools.values()].at(-1) ?? null
  const running = [...agents.values()].sort((a, b) => a.startedAt - b.startedAt)
  return { now, turnStartedAt: turn.startedAt, tool, agents: running, calls: turn.calls, errors: turn.errors, notable: turn.notable }
}

function paneData(): PaneData {
  return { snapshot: snapshot(), activity: activity(), today }
}

// A key of what the band shows that changes without an event: the minute, memory to 0.1 G, git.
function visibleKey(): string {
  const s = snapshot()
  return JSON.stringify([s.startedAt === null ? null : Math.floor((s.now - s.startedAt) / 60_000), s.memory === null ? null : Math.floor(s.memory.headroom / 107_374_182), s.git, s.model])
}

// Leaves the call count and the start time for the status line script. A failed write only leaves
// the status line one count behind.
async function writeLive($: Api) {
  if (liveFile === '') return
  try {
    await $.fs.write(liveFile, JSON.stringify({ calls, startedAt }))
  } catch {
    // the status line falls back to the session's duration
  }
}

async function openLive($: Api) {
  if (home === undefined || home === '') return
  const dir = `${home}/.local/state/mods/hud/live`
  liveFile = `${dir}/${await $.session.id()}.json`
  await writeLive($)
  try {
    // Files of sessions that ended without a session.end, such as a killed terminal: older than two
    // days. Listed with `$.fs`, so no `find`, which macOS spells differently and Windows lacks.
    const cutoff = (await $.clock.now()) - 2 * 86_400_000
    const stale = (await $.fs.list(dir)).filter((f) => f.kind === 'file' && f.name.endsWith('.json') && f.mtimeMs < cutoff)
    if (stale.length > 0) await removeFiles($, stale.map((f) => `${dir}/${f.name}`))
  } catch {
    // stale files stay until the next start
  }
}

// Deletes files with `rm`, or with `del` on Windows, where `rm` is missing unless Git's tools are on
// the PATH. `$.fs` writes but does not delete.
async function removeFiles($: Api, paths: readonly string[]): Promise<void> {
  try {
    await $.process.run(['rm', '-f', ...paths], { timeoutMs: GIT_TIMEOUT_MS })
    return
  } catch {
    // no `rm`: Windows
  }
  try {
    await $.process.run(['cmd', '/d', '/c', 'del', '/f', '/q', ...paths.map((p) => p.replaceAll('/', '\\'))], { timeoutMs: GIT_TIMEOUT_MS })
  } catch {
    // neither: the sweep at the next start tries again
  }
}

function redraw($: Api) {
  shownKey = visibleKey()
  $.ui.invalidate('ui.render')
}

// ---------------------------------------------------------------------------------------------
// Readings, done in timers and events
// ---------------------------------------------------------------------------------------------

async function readLevels($: Api): Promise<Level[]> {
  let proc = ''
  try {
    proc = await $.fs.read('/proc/self/cgroup')
  } catch {
    return []
  }
  const levels: Level[] = []
  for (const group of groups(proc)) {
    try {
      const dir = '/sys/fs/cgroup' + group
      const current = numberOrMax(await $.fs.read(dir + '/memory.current'))
      if (current === null) continue
      let inactive = 0
      try {
        inactive = inactiveFile(await $.fs.read(dir + '/memory.stat'))
      } catch {
        // no memory.stat: count all of memory.current
      }
      levels.push({ group, used: Math.max(0, current - inactive), high: numberOrMax(await $.fs.read(dir + '/memory.high')), max: numberOrMax(await $.fs.read(dir + '/memory.max')) })
    } catch {
      // a group without a memory controller
    }
  }
  return levels
}

async function readMemory($: Api): Promise<Memory | null> {
  if (!o.memory) return null
  return memory(await readLevels($), await readMachine($), MEMORY_MARGIN)
}

// The last command reading, kept for MACHINE_TTL_MS, and the one running, so the pane's refresh does
// not start a second PowerShell while the first one starts.
let machineCache: { at: number; value: Machine | null } | null = null
let machinePending: Promise<Machine | null> | null = null

async function readMachine($: Api): Promise<Machine | null> {
  try {
    return meminfo(await $.fs.read('/proc/meminfo'))
  } catch {
    // no /proc/meminfo: macOS or Windows
  }
  const at = await $.clock.now()
  if (machineCache !== null && at - machineCache.at < MACHINE_TTL_MS) return machineCache.value
  machinePending ??= commandMachine($)
  let value: Machine | null = null
  try {
    value = await machinePending
  } catch {
    // a reading that failed counts as none
  } finally {
    machinePending = null
  }
  machineCache = { at, value }
  return value
}

// The machine's memory from the system's own command, or null on any failure, which hides the field.
async function commandMachine($: Api): Promise<Machine | null> {
  try {
    if ((await $.env.get('OS')) === 'Windows_NT') {
      const r = await $.process.run(WINDOWS_COMMAND, { timeoutMs: WINDOWS_TIMEOUT_MS })
      return r.exitCode === 0 ? windowsMemory(r.stdout) : null
    }
    const size = await $.process.run(MAC_TOTAL_COMMAND, { timeoutMs: MAC_TIMEOUT_MS })
    if (size.exitCode !== 0 || macTotal(size.stdout) === null) return null
    const pages = await $.process.run(MAC_PAGES_COMMAND, { timeoutMs: MAC_TIMEOUT_MS })
    return pages.exitCode === 0 ? macMemory(size.stdout, pages.stdout) : null
  } catch {
    return null
  }
}

async function readGit($: Api): Promise<Git | null> {
  if (cwd === '') return null
  try {
    const r = await $.process.run(['git', '--no-optional-locks', '-C', cwd, 'status', '--porcelain=v2', '--branch'], { timeoutMs: GIT_TIMEOUT_MS })
    return r.exitCode === 0 ? parseGit(r.stdout) : null
  } catch {
    return null
  }
}

async function readModel($: Api): Promise<string | null> {
  try {
    const id = await $.session.model()
    return id === '' ? null : modelName(id)
  } catch {
    return null
  }
}

// Memory, git and the model, every 15 s. Redraws only when what the band shows changed.
async function lightRefresh($: Api) {
  now = await $.clock.now()
  mem = await readMemory($)
  git = await readGit($)
  model = (await readModel($)) ?? model
  if (visibleKey() !== shownKey) redraw($)
}

// The context and the plan limits. The context is missing until the first response of the window,
// and session.measure may come later than that, so tool calls ask again while it is missing.
async function readUsage($: Api) {
  try {
    const u = await $.session.usage()
    context = u.context.percent ?? null
    windows = u.rateLimits
  } catch {
    // no reading until the first measure
  }
}

async function readAgents($: Api) {
  let list
  try {
    list = await $.agent.list()
  } catch {
    return false
  }
  const running = list.filter((a) => a.status === 'running')
  let changed = running.length !== agents.size
  const ids = new Set(running.map((a) => a.id))
  for (const id of agents.keys()) if (!ids.has(id)) agents.delete(id)
  for (const a of running) {
    if (agents.has(a.id)) continue
    agents.set(a.id, { type: a.type, description: a.description, startedAt: now })
    changed = true
  }
  return changed
}

// The session's start time survives a reload of the mod in the store, one key per session.
async function loadStart($: Api) {
  try {
    const id = await $.session.id()
    const key = `started:${id}`
    const saved: unknown = await $.store.get(key)
    if (typeof saved === 'number') {
      startedAt = saved
      return
    }
    startedAt = now
    await $.store.set(key, now)
    for (const k of await $.store.keys()) {
      if (!k.startsWith('started:') || k === key) continue
      const at: unknown = await $.store.get(k)
      if (typeof at !== 'number' || now - at > KEEP_STARTS_MS) await $.store.delete(k)
    }
  } catch {
    startedAt ??= now
  }
}

// A file's text, read again only when its size changed since the last read. Null when it is gone.
async function readCached($: Api, path: string, size: number): Promise<string | null> {
  const cached = fileCache.get(path)
  if (cached !== undefined && cached.size === size) return cached.text
  // Day files pile up over the days; a full reset costs one re-read of today's few files.
  if (fileCache.size > 400) fileCache.clear()
  try {
    const text = await $.fs.read(path)
    fileCache.set(path, { size, text })
    return text
  } catch {
    fileCache.delete(path)
    return null
  }
}

// Today's diaries, through the cache above.
async function readToday($: Api): Promise<Today | null> {
  if (home === undefined) return null
  const day = localDay(now, o.timeZone)
  const files: DiaryFile[] = []
  for (const mod of TODAY_MODS) {
    const dir = `${home}/.local/state/mods/${mod}`
    let entries
    try {
      entries = await $.fs.list(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.kind !== 'file' || !mayHoldToday(entry.name, day)) continue
      const text = await readCached($, `${dir}/${entry.name}`, entry.size)
      if (text !== null) files.push({ mod, name: entry.name, text })
    }
  }
  return countToday(files, day, o.timeZone)
}

async function refreshPane($: Api) {
  now = await $.clock.now()
  mem = await readMemory($)
  today = await readToday($)
  redraw($)
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

// One row as a single line of text, its segments styled inline. The row is cut or wrapped as a whole:
// cut per segment, each one shrinks on its own and a narrow pane shows only the ends of words.
function rowElement(ui: Ui, row: Row, wrap: 'truncate' | 'wrap' = 'truncate'): RenderElement {
  return ui.Text({
    wrap,
    children: row.map((s) =>
      ui.Text({
        ...(s.tone === undefined ? {} : { color: o.colors === '' ? s.tone : style.colors[s.tone] }),
        ...(s.dim === true ? { dimColor: true } : {}),
        ...(s.bold === true ? { bold: true } : {}),
        children: [s.text],
      }),
    ),
  })
}

function bandRows(columns: number, isWorking: boolean): Row[] {
  const s = snapshot()
  const rows = o.band === 'off' ? [] : o.band === 'line' ? [lineRow(s, columns)] : panelRows(s, columns)
  const a = activity()
  if (o.activity && isWorking && a !== null) rows.push(...activityRows(a, columns))
  return rows.filter((r) => r.length > 0)
}

function sectionElement(ui: Ui, x: Section): RenderElement {
  return ui.Box({
    flexDirection: 'row',
    children: [ui.Box({ width: LABEL_WIDTH, flexShrink: 0, children: [ui.Text({ dimColor: true, children: [x.label] })] }), rowElement(ui, x.segs, 'wrap')],
  })
}

function paneElement(ui: Ui, sections: readonly Section[], refresh: () => Promise<void>): RenderElement {
  return ui.Box({
    flexDirection: 'column',
    children: [
      ...sections.map((x) => sectionElement(ui, x)),
      ui.Box({
        flexDirection: 'row',
        columnGap: 3,
        marginTop: 1,
        children: [ui.Button({ key: 'refresh', label: 'Refresh', hotkey: 'r', plain: true, onPress: refresh }), ui.Text({ dimColor: true, children: ['Esc close'] })],
      }),
    ],
  })
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

function endTurn() {
  tick?.cancel()
  tick = null
  turn = null
  tools.clear()
  agents.clear()
}

export function register(on: On, values: PluginOptions) {
  o = options(values)
  style = styleOf(o)

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    now = await $.clock.now()
    try {
      // HOME, or USERPROFILE on Windows, where HOME is usually unset.
      home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    } catch {
      home = undefined
    }
    try {
      diary = await sessionDiary($)
    } catch {
      diary = ''
    }
    await loadStart($)
    await openLive($)
    await readUsage($)
    await lightRefresh($)
    $.clock.every(LIGHT_MS, async () => {
      await lightRefresh($)
    })
    try {
      await $.command.register({ name: 'hud', description: 'Show the full heads-up display: session, limits, memory, activity, today', immediate: true })
    } catch (err) {
      await log($, { event: 'command-refused', error: String(err) })
    }
    redraw($)
    return next(e)
  })

  // `/clear`, `/resume` and `/branch` switch the session without reloading the mod.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    now = await $.clock.now()
    calls = 0
    endTurn()
    await loadStart($)
    await openLive($)
    redraw($)
    return next(e)
  }).catch(async ($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    context = e.context.percent ?? null
    windows = e.rateLimits
    now = await $.clock.now()
    redraw($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn carries its loop; the band follows the main loop's turn.
    if (Reflect.get(e, 'agentId') === undefined) {
      now = await $.clock.now()
      endTurn()
      turn = { startedAt: now, calls: 0, errors: 0, notable: null }
      model = (await readModel($)) ?? model
      tick = $.clock.every(TICK_MS, async () => {
        now = await $.clock.now()
        // The band no longer shows times or subagents; only the open /hud pane needs the redraw.
        if ((await readAgents($)) && paneTimer !== null) $.ui.invalidate('ui.render')
      })
      redraw($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && turn !== null) {
      countAction(tally, 'turns')
      endTurn()
      now = await $.clock.now()
      redraw($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) =>
    timed($, next, async (pass) => {
      now = await $.clock.now()
      calls += 1
      if (turn !== null) turn.calls += 1
      const id = String(Reflect.get(e, 'tool_use_id') ?? `call-${++toolSeq}`)
      const isMain = e.agentId === undefined
      if (isMain) tools.set(id, { name: toolName(e.tool), detail: toolDetail(e, cwd), startedAt: now })
      await writeLive($)
      $.ui.invalidate('ui.render')
      try {
        const r = await pass(e)
        if (turn !== null) {
          if ('deny' in r || r.isError === true) turn.errors += 1
          const note = notableOf({ ...(r.deny === undefined ? {} : { deny: r.deny }), ...(r.context === undefined ? {} : { context: r.context }) })
          if (note !== null) turn.notable = note
        }
        return r
      } finally {
        tools.delete(id)
        now = await $.clock.now()
        if (context === null) await readUsage($)
        $.ui.invalidate('ui.render')
      }
    }),
  ).catch(async ($, e, next) => next(e))

  // The band, shared with other mods: their content stays under these rows.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if ((o.band === 'off' && !(o.activity && e.props.isWorking)) || e.props.hasSurvey) return next(e)
    const theirs = await next(e)
    try {
      const started = Date.now()
      const ui = $.ui.resolve(e)
      const rows = bandRows(e.props.bodyColumns, e.props.isWorking).map((r) => rowElement(ui, r))
      renders += 1
      maxRenderMs = Math.max(maxRenderMs, Date.now() - started)
      if (rows.length === 0) return theirs
      return ui.Box({ flexDirection: 'column', children: [...rows, theirs] })
    } catch {
      return theirs
    }
  })

  on('command.run', { command: 'hud' }, async ($) => {
    await refreshPane($)
    git = await readGit($)
    const sections = paneSections(paneData())
    let surfaces: readonly string[] = []
    try {
      surfaces = await $.session.surfaces()
    } catch {
      // treated as a session that draws nothing
    }
    if (surfaces.length === 0) return { text: paneText(sections) }
    await $.ui.open({ id: PANE, title: 'HUD', focus: true, closeOnEscape: true })
    countAction(tally, 'pane-opened')
    paneTimer ??= $.clock.every(PANE_MS, async () => {
      await refreshPane($)
    })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    try {
      return paneElement($.ui.resolve(e), paneSections(paneData()), async () => {
        await refreshPane($)
      })
    } catch {
      return next(e)
    }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      paneTimer?.cancel()
      paneTimer = null
    }
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // One summary line per session, with the band's own cost.
  on('session.end', async ($, e, next) => {
    const t = tally
    tally = newTally()
    const extra = { renders, maxRenderMs }
    renders = 0
    maxRenderMs = 0
    endTurn()
    // A file left behind goes in the next start's sweep after two days.
    if (liveFile !== '') await removeFiles($, [liveFile])
    await log($, sessionSummary(t, e.sessionId, cwd, extra))
    return next(e)
  })
}
