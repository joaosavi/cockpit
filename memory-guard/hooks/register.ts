// Keeps heavy commands (typecheck, build, test, Playwright) below the group's memory max, where the kernel kills.
//
// Before running, the mod checks whether the command fits in the tightest group, minus the margin. If
// it does not fit, it tries with a single process. If it still does not fit, it waits for memory to
// drop. If memory does not drop, it refuses and says what is taking the memory. After running, it
// stores the command's peak for the next estimate, and reruns with a single process a command that
// died for lack of memory (exit 137).
//
// At the end of each session, one summary line in the diary counts the Bash calls the mod saw, what it
// did to them, how long it held commands waiting for memory, and the time its hook spent on its own.

import type { Elements, Hook, On, PluginOptions, RenderElement, Timer } from 'claude-code'
import {
  bar,
  cost,
  DEFAULTS,
  diedOfMemory,
  groups,
  type Heavy,
  heavy,
  headroom,
  headroomLine,
  inactiveFile,
  LEGEND,
  type Level,
  levelLine,
  MAC_PAGES_COMMAND,
  MAC_TIMEOUT_MS,
  MAC_TOTAL_COMMAND,
  type Machine,
  MACHINE_TTL_MS,
  macMemory,
  macTotal,
  machineLine,
  mb,
  meminfo,
  numberOrMax,
  type Options,
  options,
  peakKey,
  peakLines,
  reduced,
  reducedNotice,
  refusalText,
  report,
  retriedNotice,
  statusText,
  tone,
  WINDOWS_COMMAND,
  WINDOWS_TIMEOUT_MS,
  windowsMemory,
  withMeasurement,
  workingSet,
} from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]
type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

let o: Options = DEFAULTS
let diary = ''
const KEY = 'peaks'
// Below this, the variation is noise from other processes in the group.
const MIN_PEAK = 50 * 1024 * 1024
const WAIT_STEP_S = 5
const PANE = 'ram'
const PANE_REFRESH_MS = 2000

// What the /ram pane draws. The command, the timer and the Refresh button read the files; the render hook only reads this.
type Reading = { levels: Level[]; machine: Machine | null; peaks: Record<string, number[]> }
let shown: Reading = { levels: [], machine: null, peaks: {} }
let paneTimer: Timer | null = null

let cwd = ''
let tally = newTally()
// Time commands were held waiting for memory, in this session.
let waitedMs = 0

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
      levels.push({
        group,
        used: workingSet(current, inactive),
        inactiveFile: Math.min(inactive, current),
        high: numberOrMax(await $.fs.read(dir + '/memory.high')),
        max: numberOrMax(await $.fs.read(dir + '/memory.max')),
      })
    } catch {
      // group without a memory controller
    }
  }
  return levels
}

// The last command reading, kept for MACHINE_TTL_MS, and the one running, so the peak ticker does
// not start a second PowerShell while the first one starts.
let machineCache: { at: number; value: Machine | null } | null = null
let machinePending: Promise<Machine | null> | null = null

async function readMachine($: Api): Promise<Machine | null> {
  try {
    return meminfo(await $.fs.read('/proc/meminfo'))
  } catch {
    // no /proc/meminfo: macOS or Windows
  }
  const now = await $.clock.now()
  if (machineCache !== null && now - machineCache.at < MACHINE_TTL_MS) return machineCache.value
  machinePending ??= commandMachine($)
  let value: Machine | null = null
  try {
    value = await machinePending
  } catch {
    // a reading that failed counts as none
  } finally {
    machinePending = null
  }
  machineCache = { at: now, value }
  return value
}

// The machine's memory from the system's own command. Any failure gives null, which is today's
// behaviour without a reading: the command runs as it came.
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

async function headroomNow($: Api): Promise<number | null> {
  return headroom(await readLevels($), await readMachine($), o.margin)
}

async function readPeaks($: Api): Promise<Record<string, number[]>> {
  const v: unknown = await $.store.get(KEY)
  if (typeof v !== 'object' || v === null) return {}
  const peaks: Record<string, number[]> = {}
  for (const [k, n] of Object.entries(v)) {
    if (Array.isArray(n)) peaks[k] = n.filter((x): x is number => typeof x === 'number')
  }
  return peaks
}

async function storePeak($: Api, key: string, peak: number) {
  if (peak < MIN_PEAK) return
  const peaks = await readPeaks($)
  await $.store.set(KEY, { ...peaks, [key]: withMeasurement(peaks[key], peak) })
  await log($, { event: 'peak-measured', key, peak: mb(peak) })
}

// The session's own group usage right now: the first level is the session's group. Without a group, the machine's usage.
async function groupUsage($: Api): Promise<number | null> {
  const own = (await readLevels($))[0]
  if (own !== undefined) return own.used
  const m = await readMachine($)
  return m === null ? null : m.total - m.available
}

async function updateStatus($: Api) {
  $.ui.status(statusText(await headroomNow($)))
}

async function refreshRam($: Api) {
  shown = { levels: await readLevels($), machine: await readMachine($), peaks: await readPeaks($) }
  $.ui.invalidate('ui.render')
}

// One group: its name, the stacked bar sized to the pane, and the figures under it.
function levelBlock(ui: Ui, l: Level, columns: number): RenderElement {
  const runs = bar(l, columns)
  const color = tone(l, o.margin)
  const cells =
    runs === null
      ? [ui.Text({ dimColor: true, children: ['no memory limit'] })]
      : runs.map((r) =>
          r.kind === 'used'
            ? ui.Text({ color, children: [r.text] })
            : r.kind === 'mark'
              ? ui.Text({ bold: true, children: [r.text] })
              : ui.Text({ dimColor: true, children: [r.text] }),
        )
  return ui.Box({
    flexDirection: 'column',
    marginBottom: 1,
    children: [
      ui.Text({ bold: true, wrap: 'truncate-start', children: [l.group] }),
      ui.Box({ flexDirection: 'row', children: cells }),
      ui.Text({ dimColor: true, wrap: 'truncate', children: [levelLine(l)] }),
    ],
  })
}

// The /ram pane: headroom first, then one block per group from the session's own up, the measured
// peaks, and the key hint.
function ramPane(ui: Ui, r: Reading, columns: number, refresh: () => Promise<void>): RenderElement {
  const blocks: RenderElement[] = []
  const h = headroomLine(r.levels, r.machine, o.margin)
  blocks.push(ui.Text({ bold: true, wrap: 'truncate', children: [h ?? 'No memory reading on this machine'] }))
  if (r.levels.length > 0) blocks.push(ui.Text({ dimColor: true, wrap: 'truncate', children: [LEGEND] }))
  blocks.push(ui.Text({ children: [' '] }))
  for (const l of r.levels) blocks.push(levelBlock(ui, l, columns))
  if (r.levels.length === 0 && r.machine !== null) blocks.push(ui.Text({ dimColor: true, children: [machineLine(r.machine)] }))
  for (const line of peakLines(r.peaks)) blocks.push(ui.Text({ dimColor: true, wrap: 'truncate', children: [line] }))
  blocks.push(
    ui.Box({
      flexDirection: 'row',
      columnGap: 2,
      marginTop: 1,
      children: [
        ui.Button({ key: 'refresh', label: 'Refresh', hotkey: 'r', plain: true, onPress: refresh }),
        ui.Text({ dimColor: true, wrap: 'truncate', children: [`updates every ${PANE_REFRESH_MS / 1000}s · esc closes`] }),
      ],
    }),
  )
  return ui.Box({ flexDirection: 'column', children: blocks })
}

type Plan = { command: string; isReduced: boolean }

// Decides how the command runs: whole, with a single process, or not at all (null), after waiting.
// `held.ms` gets the time spent waiting.
async function fit($: Api, command: string, h: Heavy, held: { ms: number }): Promise<Plan | null> {
  const peaks = await readPeaks($)
  const smaller = reduced(command, h)
  const deadline = (await $.clock.now()) + o.waitSeconds * 1000
  let waited = false
  for (;;) {
    const free = await headroomNow($)
    if (free === null || free >= cost(h, false, peaks)) {
      if (waited) await log($, { event: 'waited-and-fit', key: h.key })
      return { command, isReduced: false }
    }
    if (smaller !== null && free >= cost(h, true, peaks)) {
      countAction(tally, 'reduced')
      await log($, { event: 'reduced', key: h.key, headroom: mb(free), waited })
      return { command: smaller, isReduced: true }
    }
    if ((await $.clock.now()) >= deadline) {
      countAction(tally, 'refused')
      await log($, { event: 'refused', key: h.key, headroom: mb(free), cost: mb(cost(h, smaller !== null, peaks)) })
      return null
    }
    if (!waited) countAction(tally, 'waited')
    waited = true
    // The wait runs inside a process, because time spent inside an API call does not count toward the
    // hook's 10 s limit, and `$.clock.sleep` does.
    const before = await $.clock.now()
    await $.process.run(['sleep', String(WAIT_STEP_S)])
    held.ms += (await $.clock.now()) - before
  }
}

// Runs the tool.call hook's body and adds its own wall time, outside `next` and outside the waits for
// memory, to the session tally. The waits go to `waitedMs`, so the hook's cost stays readable.
async function timed<I, R>($: Api, next: (input: I) => Promise<R>, body: (pass: (input: I) => Promise<R>, held: { ms: number }) => Promise<R>): Promise<R> {
  const started = await $.clock.now()
  let inside = 0
  const held = { ms: 0 }
  const pass = async (input: I): Promise<R> => {
    const at = await $.clock.now()
    try {
      return await next(input)
    } finally {
      inside += (await $.clock.now()) - at
    }
  }
  try {
    return await body(pass, held)
  } finally {
    waitedMs += held.ms
    countCall(tally, (await $.clock.now()) - started - inside - held.ms)
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
      diary = `${home}/.local/state/mods/memory-guard/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    $.clock.every(60_000, async () => {
      await updateStatus($)
    })
    try {
      await $.command.register({ name: 'ram', description: 'Show memory per group and the headroom for heavy commands', immediate: true })
    } catch (err) {
      await log($, { event: 'command-refused', error: String(err) })
    }
    return next(e)
  })

  // The text reply stays for Remote Control, which draws no pane.
  on('command.run', { command: 'ram' }, async ($) => {
    await refreshRam($)
    if ((await $.session.surfaces()).length > 0) {
      await $.ui.open({ id: PANE, title: 'Memory', focus: true, closeOnEscape: true })
      paneTimer ??= $.clock.every(PANE_REFRESH_MS, async () => {
        await refreshRam($)
      })
    }
    return { text: [report(shown.levels, shown.machine, o.margin), ...peakLines(shown.peaks)].join('\n') }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return ramPane($.ui.resolve(e), shown, e.props.bodyColumns, async () => {
      await refreshRam($)
    })
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      paneTimer?.cancel()
      paneTimer = null
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) =>
    timed($, next, async (pass, held) => {
      const h = heavy(e.command)
      if (h === null) return pass(e)
      const plan = await fit($, e.command, h, held)
      if (plan === null) {
        return { deny: refusalText(h, o.waitSeconds, report(await readLevels($), await readMachine($), o.margin)) }
      }
      const notice: string[] = []
      if (plan.isReduced) notice.push(reducedNotice(plan.command))

      // Measures the peak while the command runs. A background command returns right away and gives no measurement.
      const base = await groupUsage($)
      let highest = base ?? 0
      const ticker = e.run_in_background === true ? null : $.clock.every(1000, async () => {
        const now = await groupUsage($)
        if (now !== null && now > highest) highest = now
      })
      let r = await pass({ ...e, command: plan.command })
      ticker?.cancel()
      if (base !== null && ticker !== null) await storePeak($, peakKey(h, plan.isReduced), highest - base)

      const smaller = reduced(e.command, h)
      if (!plan.isReduced && smaller !== null && diedOfMemory(r.text ?? '')) {
        countAction(tally, 'retried-after-137')
        await log($, { event: 'retried-after-137', key: h.key })
        r = await pass({ ...e, command: smaller })
        notice.push(retriedNotice(smaller))
      }
      await updateStatus($)
      if (notice.length === 0 || 'deny' in r) return r
      return { ...r, context: [...(r.context ?? []), ...notice] }
    }),
  )

  // One summary line per session. `/clear`, `/resume` and `/branch` end a session without reloading the mod.
  on('session.end', async ($, e, next) => {
    const t = tally
    const waited = waitedMs
    tally = newTally()
    waitedMs = 0
    try {
      await log($, sessionSummary(t, e.sessionId, cwd, { waitedMs: Math.round(waited), refused: t.actions['refused'] ?? 0 }))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
