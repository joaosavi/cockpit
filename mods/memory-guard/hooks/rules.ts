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
  // Percentage of each group's max that stays free.
  margin: number
  // How long the command can wait for memory to drop before it is refused.
  waitSeconds: number
}

export const DEFAULTS: Options = { margin: 2, waitSeconds: 120 }

const MB = 1024 * 1024
const GB = 1024 * MB

// Estimates until the mod measures the command. The zippi typecheck was measured at 1 GB. The others are guesses.
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
  return { margin: number('margin', DEFAULTS.margin), waitSeconds: number('waitSeconds', DEFAULTS.waitSeconds) }
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

export function report(levels: readonly Level[], machine: { available: number; total: number } | null, margin: number): string {
  if (levels.length === 0 && machine === null) return 'no memory reading on this machine'
  const lines = levels.map((l) => {
    const high = l.high === null ? 'no high' : `high ${mb(l.high)}`
    const max = l.max === null ? 'no max' : `max ${mb(l.max)}`
    return `${l.group}: uses ${mb(l.used)} (memory.current ${mb(l.used + l.inactiveFile)} minus ${mb(l.inactiveFile)} inactive_file), ${high}, ${max}`
  })
  if (machine !== null) lines.push(`machine: ${mb(machine.available)} available of ${mb(machine.total)}`)
  const h = headroomLine(levels, machine, margin)
  if (h !== null) lines.push(h)
  return lines.join('\n')
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

export function levelLine(l: Level): string {
  const limit = limitOf(l)
  const tail = limit === null ? 'no limit' : `limit ${mb(limit.bytes)} (${limit.kind})`
  return `uses ${mb(l.used)} · inactive_file ${mb(l.inactiveFile)} · ${tail}`
}

export function headroomLine(levels: readonly Level[], machine: Machine | null, margin: number): string | null {
  const h = headroom(levels, machine, margin)
  return h === null ? null : `${mb(Math.max(0, h))} still fits, after the ${margin}% margin`
}

export function peakLines(peaks: Readonly<Record<string, readonly number[]>>): string[] {
  return Object.entries(peaks).map(([k, v]) => `measured peaks of ${k}: ${v.map(mb).join(', ')}`)
}
