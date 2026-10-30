// The rules of the memory-guard mod, without the mods API, so the tests can run them directly.

export type Kind = 'typecheck' | 'build' | 'test' | 'playwright'

export type Heavy = {
  kind: Kind
  // The part of the command that identifies what runs, to store the measured peak of each one.
  key: string
}

export type Level = {
  group: string
  // The working set: `memory.current` minus `inactive_file`, as the kubelet counts it. The kernel
  // drops inactive file cache before it swaps process memory, so that cache is not taken.
  used: number
  // The `inactive_file` of the group's `memory.stat`, shown by /ram to explain the headroom.
  inactiveFile: number
  // The group's `memory.high`, or null when it is `max`.
  high: number | null
  // The group's `memory.max`, or null when it is `max`.
  max: number | null
}

export type Options = {
  // Off, the mod registers no hook.
  enabled: boolean
  // Each step of the plan can be turned off on its own: a single process, the wait, the refusal, and
  // the rerun after exit 137. Without the refusal, a command that never fits runs as written.
  reduce: boolean
  wait: boolean
  refuse: boolean
  retry137: boolean
  // Percentage of each group's max that stays free.
  margin: number
  // How long the command can wait for memory to drop before it is refused.
  waitSeconds: number
  // cgroups outside the session's tree that /ram also shows, like a CI slice next to the agents'. They
  // never count in the headroom: the session cannot use their memory.
  alsoShow: string[]
}

export const DEFAULTS: Options = { enabled: true, reduce: true, wait: true, refuse: true, retry137: true, margin: 2, waitSeconds: 120, alsoShow: [] }

const MB = 1024 * 1024
const GB = 1024 * MB

// Estimates until the mod measures the command. A large monorepo's typecheck was measured at 1 GB. The others are guesses.
export const ESTIMATE: Record<Kind, number> = {
  typecheck: 1 * GB,
  build: 1 * GB,
  test: 600 * MB,
  playwright: 500 * MB,
}

// With reduced parallelism, the estimate drops to 60% until the mod measures it. Also a guess.
export const REDUCED_FACTOR = 0.6

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const number = (key: string, fallback: number): number => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const on = (key: string): boolean => Reflect.get(values, key) !== false
  return {
    enabled: on('enabled'),
    reduce: on('reduce'),
    wait: on('wait'),
    refuse: on('refuse'),
    retry137: on('retry137'),
    margin: number('margin', DEFAULTS.margin),
    waitSeconds: number('waitSeconds', DEFAULTS.waitSeconds),
    alsoShow: cgroupList(Reflect.get(values, 'alsoShow')),
  }
}

// "ci.slice, /other.slice" becomes ['/ci.slice', '/other.slice']. A path that climbs out with `..` is dropped.
function cgroupList(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v
    .split(',')
    .map((s) => s.trim().replace(/^\/+/, ''))
    .filter((s) => s !== '' && !s.split('/').includes('..'))
    .map((s) => '/' + s)
}

// Each rule matches a runner that actually runs, at the start of the command or after `;`, `&&`, `|` or `(`.
const START = String.raw`(?:^|[;&|(]\s*)(?:[A-Z_]+=\S+\s+)*(?:timeout\s+\d+\s+)?`
// The package manager, with the workspace or filter that picks the package.
const MANAGER = String.raw`(?:yarn(?:\s+workspace\s+\S+)?|npm\s+run|pnpm(?:\s+--filter\s+\S+)?|bun\s+run)`
const RULES: Array<[Kind, RegExp]> = [
  ['playwright', new RegExp(START + String.raw`((?:npx|yarn|pnpm|bunx)\s+playwright\s+test|playwright\s+test)`)],
  ['typecheck', new RegExp(START + `(${MANAGER}\\s+(?:turbo\\s+run\\s+)?typecheck|` + String.raw`(?:npx\s+|yarn\s+)?(?:turbo\s+run\s+typecheck|vue-tsc|tsc)\b(?!\s+--version))`)],
  ['build', new RegExp(START + `(${MANAGER}\\s+(?:turbo\\s+run\\s+)?build|` + String.raw`(?:npx\s+|yarn\s+)?(?:turbo\s+run\s+build|next\s+build|vite\s+build))\b`)],
  ['test', new RegExp(START + `(${MANAGER}\\s+(?:turbo\\s+run\\s+)?(?:test|e2e|vitest)|npm\\s+test|` + String.raw`(?:npx\s+|yarn\s+)?(?:turbo\s+run\s+test|vitest|jest))\b`)],
]

// The command without heredoc bodies and without quoted text, so a `tsc` quoted in a commit message
// or in a file written with `cat <<EOF` does not count.
export function executable(command: string): string {
  const lines = command.split('\n')
  const outside: string[] = []
  let end: string | null = null
  for (const line of lines) {
    if (end !== null) {
      if (line.trim() === end) end = null
      continue
    }
    const heredoc = /<<-?\s*['"]?(\w+)['"]?/.exec(line)
    if (heredoc?.[1] !== undefined) end = heredoc[1]
    outside.push(line)
  }
  return outside.join('\n').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
}

export function heavy(command: string): Heavy | null {
  const clean = executable(command)
  for (const [kind, re] of RULES) {
    const m = re.exec(clean)
    if (m?.[1] !== undefined) return { kind, key: m[1].replace(/\s+/g, ' ') }
  }
  return null
}

// The flag each runner accepts to run with a single process. tsc has none.
export function reduced(command: string, h: Heavy): string | null {
  if (/--concurrency|--maxWorkers|--workers|-w\s+\d|--pool/.test(command)) return null
  const flag = h.key.includes('turbo')
    ? '--concurrency=1'
    : h.kind === 'playwright'
      ? '--workers=1'
      : /vitest|jest/.test(h.key)
        ? '--maxWorkers=1'
        : null
  if (flag === null) return null
  // The flag goes after the whole word, so `turbo run test:unit` does not become `test --concurrency=1:unit`.
  const start = command.indexOf(h.key)
  if (start < 0) return null
  let end = start + h.key.length
  while (end < command.length && !/[\s;&|)]/.test(command.charAt(end))) end += 1
  return `${command.slice(0, end)} ${flag}${command.slice(end)}`
}

// The last measurements of each command. The peak is measured on the whole group, and another session
// starting at the same time inflates the measurement. Keeping only the last ones lets an inflated
// measurement age out on its own.
export const KEPT_MEASUREMENTS = 3

export function cost(h: Heavy, isReduced: boolean, peaks: Readonly<Record<string, readonly number[]>>): number {
  const measurements = peaks[peakKey(h, isReduced)]
  if (measurements !== undefined && measurements.length > 0) return Math.max(...measurements)
  return isReduced ? ESTIMATE[h.kind] * REDUCED_FACTOR : ESTIMATE[h.kind]
}

export function withMeasurement(measurements: readonly number[] | undefined, fresh: number): number[] {
  return [...(measurements ?? []), fresh].slice(-KEPT_MEASUREMENTS)
}

export function peakKey(h: Heavy, isReduced: boolean): string {
  return isReduced ? `${h.key} (1 process)` : h.key
}

// How much still fits without passing the max (where the kernel kills), minus the margin, in the
// tightest group. Past the high mark the group only slows down, so the high counts only for a group
// with no max. With no group that has a limit, as on a PC, the machine's available memory minus the
// margin applies.
export function headroom(levels: readonly Level[], machine: { available: number; total: number } | null, margin: number): number | null {
  const limited = levels.flatMap((l) => {
    const limit = l.max ?? l.high
    return limit === null ? [] : [limit * (1 - margin / 100) - l.used]
  })
  if (limited.length > 0) return Math.min(...limited)
  if (machine === null) return null
  return machine.available - machine.total * (margin / 100)
}

export function numberOrMax(text: string): number | null {
  const t = text.trim()
  if (t === 'max') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function groups(procCgroup: string): string[] {
  const path = procCgroup.trim().split('\n').find((l) => l.startsWith('0::'))?.slice(3) ?? ''
  const parts = path.split('/').filter((p) => p !== '')
  return parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/')).reverse()
}

export function meminfo(text: string): { available: number; total: number } | null {
  const kb = (name: string): number | null => {
    const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text)
    return m?.[1] === undefined ? null : Number(m[1]) * 1024
  }
  const available = kb('MemAvailable')
  const total = kb('MemTotal')
  return available === null || total === null ? null : { available, total }
}

// Where there is no /proc/meminfo, the machine's memory comes from a command. The mod tells Windows
// by `OS=Windows_NT`, which Windows sets for every process, and tries the macOS commands elsewhere.
export const MAC_TOTAL_COMMAND = ['sysctl', '-n', 'hw.memsize']
export const MAC_PAGES_COMMAND = ['vm_stat']
export const WINDOWS_COMMAND = [
  'powershell',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '(Get-CimInstance Win32_OperatingSystem | Select TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json)',
]
// How long a command reading stays fresh. PowerShell takes about a second to start, and the peak
// ticker asks every second while a heavy command runs.
export const MACHINE_TTL_MS = 10_000
export const MAC_TIMEOUT_MS = 2000
export const WINDOWS_TIMEOUT_MS = 5000

// The output of `sysctl -n hw.memsize`: the total in bytes, or null.
export function macTotal(text: string): number | null {
  const t = text.trim()
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null
}

// macOS: the total from `sysctl -n hw.memsize`, and as available the free, inactive, speculative and
// purgeable pages of `vm_stat`, times the page size its header prints.
export function macMemory(memsize: string, vmStat: string): Machine | null {
  const total = macTotal(memsize)
  const page = /page size of (\d+) bytes/.exec(vmStat)?.[1]
  if (total === null || page === undefined) return null
  const pages = (name: string): number | null => {
    const m = new RegExp(`^Pages ${name}:\\s+(\\d+)\\.?\\s*$`, 'm').exec(vmStat)
    return m?.[1] === undefined ? null : Number(m[1])
  }
  const free = pages('free')
  if (free === null) return null
  const count = free + (pages('inactive') ?? 0) + (pages('speculative') ?? 0) + (pages('purgeable') ?? 0)
  return { available: Math.min(total, count * Number(page)), total }
}

// Windows: the JSON of `Win32_OperatingSystem`, both values in KiB.
export function windowsMemory(json: string): Machine | null {
  let v: unknown
  try {
    v = JSON.parse(json.trim())
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const kib = (key: string): number | null => {
    const n: unknown = Reflect.get(v, key)
    const x = typeof n === 'number' ? n : typeof n === 'string' && /^\d+$/.test(n.trim()) ? Number(n) : Number.NaN
    return Number.isFinite(x) && x >= 0 ? x * 1024 : null
  }
  const total = kib('TotalVisibleMemorySize')
  const available = kib('FreePhysicalMemory')
  return total === null || available === null || total === 0 ? null : { available: Math.min(total, available), total }
}

export function mb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`
}

export function diedOfMemory(text: string): boolean {
  return /exit code 137|\bkilled\b.*signal 9|out of memory/i.test(text)
}

// The `inactive_file` line of a cgroup's `memory.stat`, in bytes, or 0 when the line is missing.
export function inactiveFile(stat: string): number {
  const m = /^inactive_file (\d+)$/m.exec(stat)
  return m?.[1] === undefined ? 0 : Number(m[1])
}

export function workingSet(current: number, inactive: number): number {
  return Math.max(0, current - inactive)
}

// One group in plain words: what it uses, the file cache on top, and its limits.
function groupText(l: Level): string {
  const limits = [l.high === null ? null : `high ${mb(l.high)}`, l.max === null ? null : `max ${mb(l.max)}`].filter((x) => x !== null)
  const cache = l.inactiveFile > 0 ? [`${mb(l.inactiveFile)} file cache`] : []
  return [`${mb(l.used)} in use`, ...cache, ...(limits.length === 0 ? ['no limit'] : limits)].join(', ')
}

// The /ram reply and the refusal's explanation: plain lines, so it reads the same in Remote Control.
export function report(
  levels: readonly Level[],
  machine: { available: number; total: number } | null,
  margin: number,
  others: readonly Level[] = [],
): string {
  if (levels.length === 0 && machine === null && others.length === 0) return 'No memory reading on this machine.'
  const lines: string[] = []
  const h = headroomLine(levels, machine, margin)
  if (h !== null) lines.push(h)
  for (const l of levels) lines.push(`${l.group}: ${groupText(l)}`)
  if (machine !== null) lines.push(machineLine(machine))
  if (others.length > 0) lines.push(ALSO_WATCHED, ...others.map((l) => `${l.group}: ${groupText(l)}`))
  return lines.join('\n')
}

export const ALSO_WATCHED = 'Also watched:'

export function machineLine(m: { available: number; total: number }): string {
  return `Machine: ${mb(m.available)} available of ${mb(m.total)}`
}

export type Machine = { available: number; total: number }

// The limit a group's bar is drawn against: the max, where the kernel kills, or the high mark when there is no max.
export function limitOf(l: Level): { bytes: number; kind: 'max' | 'high' } | null {
  if (l.max !== null) return { bytes: l.max, kind: 'max' }
  if (l.high !== null) return { bytes: l.high, kind: 'high' }
  return null
}

// Theme colors of the working set, by how much of the limit minus the margin it takes: green below 75%, yellow below 90%, red from 90%.
export type Tone = 'success' | 'warning' | 'error'

export function tone(l: Level, margin: number): Tone {
  const limit = limitOf(l)
  if (limit === null) return 'success'
  const ratio = l.used / (limit.bytes * (1 - margin / 100))
  if (ratio >= 0.9) return 'error'
  if (ratio >= 0.75) return 'warning'
  return 'success'
}

// A run of equal cells of a group's bar: working set (`█`), inactive_file cache (`▒`), free up to the limit (`░`), the high mark (`│`).
export type Run = { kind: 'used' | 'cache' | 'free' | 'mark'; text: string }

const CHAR: Record<Run['kind'], string> = { used: '█', cache: '▒', free: '░', mark: '│' }

export function bar(l: Level, width: number): Run[] | null {
  const limit = limitOf(l)
  if (limit === null || limit.bytes <= 0) return null
  const cell = (bytes: number) => Math.min(width, Math.max(0, Math.round((bytes / limit.bytes) * width)))
  const used = cell(l.used)
  const cache = cell(l.used + l.inactiveFile)
  const mark = l.high !== null && l.max !== null ? Math.min(width - 1, cell(l.high)) : -1
  const runs: Run[] = []
  for (let i = 0; i < width; i++) {
    const kind: Run['kind'] = i === mark ? 'mark' : i < used ? 'used' : i < cache ? 'cache' : 'free'
    const last = runs.at(-1)
    if (last !== undefined && last.kind === kind) last.text += CHAR[kind]
    else runs.push({ kind, text: CHAR[kind] })
  }
  return runs
}

// The figures under a group's bar in the /ram pane.
export function levelLine(l: Level): string {
  const limits = [l.high === null ? null : `high ${mb(l.high)}`, l.max === null ? null : `max ${mb(l.max)}`].filter((x) => x !== null)
  const cache = l.inactiveFile > 0 ? [`${mb(l.inactiveFile)} cache`] : []
  return [`${mb(l.used)} in use`, ...cache, ...(limits.length === 0 ? ['no limit'] : limits)].join(' · ')
}

export const LEGEND = '█ in use  ▒ file cache  ░ free  │ high mark'

export function headroomLine(levels: readonly Level[], machine: Machine | null, margin: number): string | null {
  const h = headroom(levels, machine, margin)
  return h === null ? null : `Headroom: ${mb(Math.max(0, h))}, after the ${margin}% margin`
}

// The status line under the prompt: shown only when memory is tight, so it does not become background noise.
export const STATUS_BELOW = 500 * MB

export function statusText(h: number | null): string | undefined {
  return h === null || h > STATUS_BELOW ? undefined : `Memory headroom: ${mb(Math.max(0, h))}`
}

export function peakLines(peaks: Readonly<Record<string, readonly number[]>>): string[] {
  return Object.entries(peaks).map(([k, v]) => `Measured peak${v.length === 1 ? '' : 's'} of ${k}: ${v.map(mb).join(', ')}`)
}

export function refusalText(h: Heavy, waitSeconds: number, explanation: string): string {
  return (
    `memory-guard: refused ${h.key} after waiting ${waitSeconds}s for memory; another session or process holds it.\n${explanation}\n` +
    'Tell the user, or continue with work that does not need this command.'
  )
}

export function reducedNotice(command: string): string {
  return `memory-guard: the full command did not fit in memory, so it ran with a single process: ${command}`
}

export function retriedNotice(command: string): string {
  return `memory-guard: the first run died of memory (exit 137), so it reran with a single process: ${command}`
}
