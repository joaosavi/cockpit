// Keeps heavy commands (typecheck, build, test, Playwright) below the group's memory max, where the kernel kills.
//
// Before running, the mod checks whether the command fits in the tightest group, minus the margin. If
// it does not fit, it tries with a single process. If it still does not fit, it waits for memory to
// drop. If memory does not drop, it refuses and says what is taking the memory. After running, it
// stores the command's peak for the next estimate, and reruns with a single process a command that
// died for lack of memory (exit 137).

import type { Hook, On, PluginOptions } from 'claude-code'
import {
  cost,
  DEFAULTS,
  diedOfMemory,
  groups,
  type Heavy,
  heavy,
  headroom,
  type Level,
  mb,
  meminfo,
  numberOrMax,
  type Options,
  options,
  peakKey,
  reduced,
  report,
  withMeasurement,
} from './rules.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = DEFAULTS
let diary = ''
const KEY = 'peaks'
// Below this, the variation is noise from other processes in the group.
const MIN_PEAK = 50 * 1024 * 1024
const WAIT_STEP_S = 5

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
      const used = numberOrMax(await $.fs.read(dir + '/memory.current'))
      if (used === null) continue
      levels.push({
        group,
        used,
        high: numberOrMax(await $.fs.read(dir + '/memory.high')),
        max: numberOrMax(await $.fs.read(dir + '/memory.max')),
      })
    } catch {
      // group without a memory controller
    }
  }
  return levels
}

async function readMachine($: Api) {
  try {
    return meminfo(await $.fs.read('/proc/meminfo'))
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
  const h = await headroomNow($)
  // Shows up only when memory is tight, so the line with the ⚠ does not become background noise.
  if (h === null || h > 500 * 1024 * 1024) $.ui.status(undefined)
  else $.ui.status(`${mb(Math.max(0, h))} fits before the memory max`)
}

// Decides how the command runs: whole, with a single process, or not at all, after waiting.
async function fit($: Api, command: string, h: Heavy): Promise<{ command: string; isReduced: boolean } | null> {
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
      await log($, { event: 'reduced', key: h.key, headroom: mb(free), waited })
      return { command: smaller, isReduced: true }
    }
    if ((await $.clock.now()) >= deadline) {
      await log($, { event: 'refused', key: h.key, headroom: mb(free), cost: mb(cost(h, smaller !== null, peaks)) })
      return null
    }
    waited = true
    // The wait runs inside a process, because time spent inside an API call does not count toward the
    // hook's 10 s limit, and `$.clock.sleep` does.
    await $.process.run(['sleep', String(WAIT_STEP_S)])
  }
}

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    if (home !== undefined) {
      const dir = `${home}/.local/state/mods/memory-guard`
      await $.process.run(['mkdir', '-p', dir])
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${dir}/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    $.clock.every(60_000, async () => {
      await updateStatus($)
    })
    try {
      await $.command.register({ name: 'ram', description: 'Shows the memory of each group and how much still fits', immediate: true })
    } catch (err) {
      await log($, { event: 'command-refused', error: String(err) })
    }
    return next(e)
  })

  on('command.run', { command: 'ram' }, async ($) => {
    const peaks = Object.entries(await readPeaks($)).map(([k, v]) => `measured peaks of ${k}: ${v.map(mb).join(', ')}`)
    return { text: [report(await readLevels($), await readMachine($), o.margin), ...peaks].join('\n') }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const h = heavy(e.command)
    if (h === null) return next(e)
    const plan = await fit($, e.command, h)
    if (plan === null) {
      return {
        deny:
          `The memory-guard mod held this command (${h.key}) for ${o.waitSeconds} s and the group's memory did not drop enough. ` +
          `Another session or process is taking the memory:\n${report(await readLevels($), await readMachine($), o.margin)}\n` +
          'Do not try again now. Tell the user, or continue with work that does not need this command.',
      }
    }
    const notice: string[] = []
    if (plan.isReduced) notice.push(`The memory-guard mod ran the command with a single process, because the whole command did not fit in the group's memory: ${plan.command}`)

    // Measures the peak while the command runs. A background command returns right away and gives no measurement.
    const base = await groupUsage($)
    let highest = base ?? 0
    const ticker = e.run_in_background === true ? null : $.clock.every(1000, async () => {
      const now = await groupUsage($)
      if (now !== null && now > highest) highest = now
    })
    let r = await next({ ...e, command: plan.command })
    ticker?.cancel()
    if (base !== null && ticker !== null) await storePeak($, peakKey(h, plan.isReduced), highest - base)

    const smaller = reduced(e.command, h)
    if (!plan.isReduced && smaller !== null && diedOfMemory(r.text ?? '')) {
      await log($, { event: 'retried-after-137', key: h.key })
      r = await next({ ...e, command: smaller })
      notice.push(`The first attempt died for lack of memory, and the memory-guard mod reran it with a single process: ${smaller}`)
    }
    await updateStatus($)
    if (notice.length === 0 || 'deny' in r) return r
    return { ...r, context: [...(r.context ?? []), ...notice] }
  })
}
