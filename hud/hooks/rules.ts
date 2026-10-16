// The hud mod's rules, without the mods API, so the tests run them directly: parsing what the timers
// read, and laying out every row the band and the /hud pane draw, sized to the columns they get.
//
// A row is a list of segments, each a piece of text and its style. The layout functions pad and drop
// segments so a row never passes the columns it is given, and never cuts an element in the middle.

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

export type BandMode = 'panel' | 'line' | 'off'

export type BarStyle = 'blocks' | 'solid' | 'line' | 'dots' | 'squares'
// The status line's layout, and the glyph set it draws its icons with.
export type StatusStyle = 'refined' | 'blocks' | 'minimal' | 'compact'
export type IconSet = 'nerd' | 'unicode'
// How the status line colors its bars: `gradient` gives each cell the color of its place, green at
// the start to red at the end; `solid` paints the whole bar one color that slides from green to red
// with the percent; `tone` keeps the three threshold colors of the `colors` option.
export type BarColor = 'gradient' | 'solid' | 'tone'
export type ContextBase = 'compact' | 'window'

// Fields the `hide` option takes, by the names the README gives them.
export const FIELDS = ['model', 'project', 'branch', 'age', 'calls', 'ctx', '5h', '7d', 'reset', 'mem'] as const
export type Field = (typeof FIELDS)[number]

export type Options = {
  band: BandMode
  activity: boolean
  memory: boolean
  timeZone: string
  bar: BarStyle
  barWidth: number
  colors: string
  hide: string
  contextBase: ContextBase
  style: StatusStyle
  icons: IconSet
  barColor: BarColor
}

export const DEFAULTS: Options = {
  band: 'panel',
  activity: true,
  memory: true,
  timeZone: '',
  bar: 'dots',
  barWidth: 10,
  colors: '',
  hide: '',
  contextBase: 'compact',
  style: 'refined',
  icons: 'nerd',
  barColor: 'gradient',
}

// Percentage of each cgroup's limit kept free, as memory-guard counts it.
export const MEMORY_MARGIN = 2

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const text = (key: string, fallback: string): string => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
  }
  const flag = (key: string, fallback: boolean): boolean => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'boolean' ? v : fallback
  }
  const band = text('band', DEFAULTS.band)
  const bar = text('bar', DEFAULTS.bar)
  const widthOf: unknown = Reflect.get(values, 'barWidth')
  const barWidth = typeof widthOf === 'number' ? widthOf : Number(widthOf)
  return {
    band: band === 'line' || band === 'off' ? band : 'panel',
    activity: flag('activity', DEFAULTS.activity),
    memory: flag('memory', DEFAULTS.memory),
    timeZone: validTimeZone(text('timeZone', DEFAULTS.timeZone)),
    bar: bar === 'solid' || bar === 'line' || bar === 'blocks' || bar === 'squares' ? bar : 'dots',
    barWidth: Number.isFinite(barWidth) && barWidth >= 4 && barWidth <= 30 ? Math.round(barWidth) : DEFAULTS.barWidth,
    colors: text('colors', DEFAULTS.colors),
    hide: text('hide', DEFAULTS.hide),
    contextBase: text('contextBase', DEFAULTS.contextBase) === 'window' ? 'window' : 'compact',
    style: oneOf(text('style', DEFAULTS.style), ['refined', 'blocks', 'minimal', 'compact'] as const, DEFAULTS.style),
    icons: oneOf(text('icons', DEFAULTS.icons), ['nerd', 'unicode'] as const, DEFAULTS.icons),
    barColor: oneOf(text('barColor', DEFAULTS.barColor), ['gradient', 'solid', 'tone'] as const, DEFAULTS.barColor),
  }
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value.toLowerCase()) ?? fallback
}

// How the rows look: the bar glyphs and width, the color of each tone, and the fields left out.
export type Style = { on: string; off: string; barWidth: number; colors: Record<Tone, string>; hide: ReadonlySet<Field> }

const BARS: Record<BarStyle, [string, string]> = { blocks: ['▰', '▱'], solid: ['█', '░'], line: ['━', '─'], dots: ['●', '○'], squares: ['■', '□'] }
const TONE_DEFAULTS: Record<Tone, string> = { success: 'green', warning: 'yellow', error: 'red' }

// A color the terminal and the band both take: a basic name, `bright-` and a name, `#rrggbb`, or
// 0 to 255 for the 256-color palette. Anything else falls back to the tone's default.
const COLOR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray', 'grey']
export function validColor(c: string): boolean {
  const name = c.toLowerCase()
  return COLOR_NAMES.includes(name.replace(/^bright-/, '')) || /^#[0-9a-f]{6}$/i.test(c) || (/^\d{1,3}$/.test(c) && Number(c) <= 255)
}

export function styleOf(o: Options): Style {
  const [on, off] = BARS[o.bar]
  const given = o.colors.split(/[\s,]+/).filter((c) => c !== '')
  const tones: Tone[] = ['success', 'warning', 'error']
  const colors = { ...TONE_DEFAULTS }
  tones.forEach((t, i) => {
    const c = given[i]
    if (c !== undefined && validColor(c)) colors[t] = c
  })
  const hide = new Set<Field>()
  for (const f of o.hide.toLowerCase().split(/[\s,]+/)) if ((FIELDS as readonly string[]).includes(f)) hide.add(f as Field)
  return { on, off, barWidth: o.barWidth, colors, hide }
}

export const DEFAULT_STYLE: Style = styleOf(DEFAULTS)

// A time zone the runtime knows, or empty for the system's own. An unknown name falls back to empty.
function validTimeZone(tz: string): string {
  if (tz === '') return ''
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return ''
  }
}

// The `timeZone` field of a date format: absent when empty, so the system time zone applies.
export function zone(timeZone: string): { timeZone?: string } {
  return timeZone === '' ? {} : { timeZone }
}

export function expandHome(path: string, home: string | undefined): string | null {
  if (path === '~' || path.startsWith('~/')) return home === undefined || home === '' ? null : home + path.slice(1)
  return path
}

// ---------------------------------------------------------------------------------------------
// Segments and rows
// ---------------------------------------------------------------------------------------------

export type Tone = 'success' | 'warning' | 'error'

// Colors beyond the three tones, for the status line's git and PR fields.
export type Hue = 'branch' | 'ahead' | 'behind' | 'pr' | 'accent'

// `chip` paints the segment's background, for the blocks style: `strong` for the model, `soft` for the rest.
// `rgb` is a 24-bit color, which wins over `tone` and `hue`.
export type Seg = { text: string; tone?: Tone; hue?: Hue; rgb?: readonly [number, number, number]; dim?: boolean; bold?: boolean; italic?: boolean; chip?: 'strong' | 'soft' }

// Green at 0, yellow at 0.5, red at 1: the heat of a bar cell or of a percent.
export function heat(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? [Math.round(510 * x), 200, 80] : [255, Math.round(200 * (2 - 2 * x)), 80]
}
export type Row = Seg[]

export function width(row: readonly Seg[]): number {
  return row.reduce((n, s) => n + [...s.text].length, 0)
}

export function rowText(row: readonly Seg[]): string {
  return row.map((s) => s.text).join('')
}

export function gap(n: number): Seg {
  return { text: ' '.repeat(Math.max(0, n)) }
}

// Left segments, then the right ones flush with the last column. Null when both do not fit.
export function spread(left: readonly Seg[], right: readonly Seg[], columns: number): Row | null {
  const room = columns - width(left) - width(right)
  if (room < 2) return null
  return [...left, gap(room), ...right]
}

// Cuts text to `max` characters with an ellipsis. Used only for free text (commands, descriptions),
// never for a figure.
export function cut(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  if (max <= 1) return max === 1 ? '…' : ''
  return chars.slice(0, max - 1).join('') + '…'
}

// ---------------------------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------------------------

const MODEL = /^(?:[a-z]+\.)?(?:anthropic\.)?claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-v\d+(?::\d+)?)?(?:\[[^\]]*\])?$/i

// `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`. Anything else as given.
export function modelName(id: string): string {
  const m = MODEL.exec(id.trim())
  if (m === null || m[1] === undefined || m[2] === undefined) return id.trim()
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return m[3] === undefined ? `${family} ${m[2]}` : `${family} ${m[2]}.${m[3]}`
}

export function basename(path: string): string {
  const parts = path.split('/').filter((p) => p !== '')
  return parts.at(-1) ?? path
}

// 42_000 → `0:42`, 3_725_000 → `1:02:05`.
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// How long the session has run: `38m`, `2h 05m`.
export function age(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const MiB = 1024 * 1024
const GiB = 1024 * MiB

// 2_040_109_465 → `1.9G`, 440_401_920 → `420M`.
export function bytes(n: number): string {
  if (n >= GiB) return `${(Math.floor((n / GiB) * 10) / 10).toFixed(1)}G`
  return `${Math.max(0, Math.round(n / MiB))}M`
}

// Used over limit in the limit's unit: `2.6/5.0G`, `300/800M`.
export function ratio(used: number, limit: number): string {
  if (limit >= GiB) return `${(Math.floor((Math.max(0, used) / GiB) * 10) / 10).toFixed(1)}/${bytes(limit)}`
  return `${Math.max(0, Math.round(used / MiB))}/${bytes(limit)}`
}

export function percentTone(percent: number, warnFrom: number, errorFrom: number): Tone {
  if (percent >= errorFrom) return 'error'
  if (percent >= warnFrom) return 'warning'
  return 'success'
}

export const contextTone = (p: number): Tone => percentTone(p, 60, 85)
export const limitTone = (p: number): Tone => percentTone(p, 75, 90)

export function memoryTone(headroom: number): Tone {
  if (headroom < 500 * MiB) return 'error'
  if (headroom < 1024 * MiB) return 'warning'
  return 'success'
}

// The day a moment falls on in a time zone, as `YYYY-MM-DD`.
export function localDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { ...zone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

// The time left until a reset, as the countdown Claude Code shows: `2h30m`, `45m`, `3d20h`. Null for
// a date that does not parse. A reset already passed reads `0m`.
export function resetIn(iso: string, now: number): string | null {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  const m = Math.max(0, Math.ceil((at - now) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

// ---------------------------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------------------------

// The branch, and the counts the status line shows: commits ahead of and behind the upstream, files
// staged, files changed outside the stage (conflicts included), and untracked files.
export type Git = { branch: string; isDirty: boolean; ahead?: number; behind?: number; staged?: number; modified?: number; untracked?: number }

// The output of `git status --porcelain=v2 --branch`.
export function parseGit(stdout: string): Git | null {
  let head: string | null = null
  let oid: string | null = null
  let ahead = 0
  let behind = 0
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') staged += 1
      if (xy[1] !== '.') modified += 1
    } else if (line.startsWith('u ')) modified += 1
    else if (line.startsWith('? ')) untracked += 1
  }
  if (head === null) return null
  const isDirty = staged + modified + untracked > 0
  const branch = head === '(detached)' ? (oid === null || oid === '(initial)' ? 'detached' : oid.slice(0, 7)) : head
  return { branch, isDirty, ahead, behind, staged, modified, untracked }
}

// The open pull request of the branch, with its checks rolled up: `ok` when all passed, `fail` when
// any failed, `pending` while any runs, `none` without checks.
export type Pr = { number: number; checks: 'ok' | 'fail' | 'pending' | 'none' }

// `gh pr view --json number,state,statusCheckRollup`: the PR when it is open, else null.
export function parsePr(json: string): Pr | null {
  try {
    const v: unknown = JSON.parse(json)
    if (typeof v !== 'object' || v === null) return null
    const n: unknown = Reflect.get(v, 'number')
    if (typeof n !== 'number' || Reflect.get(v, 'state') !== 'OPEN') return null
    const rollup: unknown = Reflect.get(v, 'statusCheckRollup')
    const items = Array.isArray(rollup) ? (rollup as unknown[]) : []
    let fail = false
    let pending = false
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const conclusion = String(Reflect.get(item, 'conclusion') ?? '')
      const status = String(Reflect.get(item, 'status') ?? '')
      const state = String(Reflect.get(item, 'state') ?? '')
      if (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(conclusion) || ['FAILURE', 'ERROR'].includes(state)) fail = true
      else if ((status !== '' && status !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(state)) pending = true
    }
    return { number: n, checks: items.length === 0 ? 'none' : fail ? 'fail' : pending ? 'pending' : 'ok' }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Memory, as memory-guard reads it
// ---------------------------------------------------------------------------------------------

export type Level = {
  group: string
  // memory.current minus the inactive_file of memory.stat: the kernel drops that cache before it kills.
  used: number
  high: number | null
  max: number | null
}

export type Machine = { available: number; total: number }

export function numberOrMax(text: string): number | null {
  const t = text.trim()
  if (t === 'max') return null
  const n = Number(t)
  return t !== '' && Number.isFinite(n) ? n : null
}

// The session's cgroup and each parent, innermost first.
export function groups(procCgroup: string): string[] {
  const path = procCgroup.trim().split('\n').find((l) => l.startsWith('0::'))?.slice(3) ?? ''
  const parts = path.split('/').filter((p) => p !== '')
  return parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/')).reverse()
}

export function inactiveFile(stat: string): number {
  const m = /^inactive_file (\d+)$/m.exec(stat)
  return m?.[1] === undefined ? 0 : Number(m[1])
}

export function meminfo(text: string): Machine | null {
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
// The same reading as memory-guard's.
export const MAC_TOTAL_COMMAND = ['sysctl', '-n', 'hw.memsize']
export const MAC_PAGES_COMMAND = ['vm_stat']
export const WINDOWS_COMMAND = [
  'powershell',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '(Get-CimInstance Win32_OperatingSystem | Select TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json)',
]
// How long a command reading stays fresh: PowerShell takes about a second to start, and the light
// refresh reads every 15 s.
export const MACHINE_TTL_MS = 15_000
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

export type Memory = {
  // What still fits before the tightest limit, after the margin.
  headroom: number
  // The session's own group, when it has one.
  session: number | null
  // The group whose limit sets the headroom, when it is not the session's own group.
  bound: { name: string; used: number; limit: number } | null
  // The machine, when no group has a limit.
  machine: Machine | null
}

function groupName(path: string): string {
  const leaf = basename(path)
  if (leaf.endsWith('.slice')) return 'slice'
  if (leaf.endsWith('.service')) return 'service'
  if (leaf.endsWith('.scope')) return 'scope'
  return 'group'
}

// The limit is memory.max, where the kernel kills, or memory.high for a group without a max.
export function memory(levels: readonly Level[], machine: Machine | null, margin: number): Memory | null {
  const keep = 1 - margin / 100
  let tightest: { level: Level; limit: number; room: number } | null = null
  for (const level of levels) {
    const limit = level.max ?? level.high
    if (limit === null) continue
    const room = limit * keep - level.used
    if (tightest === null || room < tightest.room) tightest = { level, limit, room }
  }
  const own = levels[0]
  if (tightest !== null) {
    const isOwn = own !== undefined && tightest.level.group === own.group
    return {
      headroom: Math.max(0, tightest.room),
      session: own?.used ?? null,
      bound: isOwn ? { name: 'session', used: tightest.level.used, limit: tightest.limit } : { name: groupName(tightest.level.group), used: tightest.level.used, limit: tightest.limit },
      machine: null,
    }
  }
  if (machine === null) return null
  return { headroom: Math.max(0, machine.available - machine.total * (margin / 100)), session: own?.used ?? null, bound: null, machine }
}

// ---------------------------------------------------------------------------------------------
// What the band shows
// ---------------------------------------------------------------------------------------------

export type Window = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  now: number
  timeZone: string
  model: string | null
  project: string | null
  git: Git | null
  // When the session started, or null when unknown.
  startedAt: number | null
  calls: number
  context: number | null
  windows: readonly Window[]
  memory: Memory | null
  // Absent, the default style.
  style?: Style
  // The branch's open pull request, read by the status line script only.
  pr?: Pr | null
}

// The snapshot with the hidden fields taken out, so every layout leaves them out the same way.
export function visible(s: Snapshot): Snapshot {
  const hide = s.style?.hide
  if (hide === undefined || hide.size === 0) return s
  return {
    ...s,
    model: hide.has('model') ? null : s.model,
    project: hide.has('project') ? null : s.project,
    git: hide.has('branch') ? null : s.git,
    startedAt: hide.has('age') ? null : s.startedAt,
    context: hide.has('ctx') ? null : s.context,
    windows: s.windows
      .filter((w) => !(hide.has('5h') && w.kind === 'five_hour') && !(hide.has('7d') && w.kind === 'seven_day'))
      .map((w) => (hide.has('reset') ? { kind: w.kind, percentUsed: w.percentUsed } : w)),
    memory: hide.has('mem') ? null : s.memory,
  }
}

export function windowOf(s: Snapshot, kind: string): Window | null {
  return s.windows.find((w) => w.kind === kind) ?? null
}

function barSegs(percent: number, cells: number, tone: Tone, style: Style): Seg[] {
  const on = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  const segs: Seg[] = []
  if (on > 0) segs.push({ text: style.on.repeat(on), tone })
  if (cells - on > 0) segs.push({ text: style.off.repeat(cells - on), dim: true })
  return segs
}

function pct(p: number): string {
  return `${Math.round(p)}%`
}

// One meter: `ctx ▰▰▰▱▱ 42%`, or `ctx 42%` without a bar, with the reset time after it when asked.
function meter(label: string, percent: number, tone: Tone, cells: number, reset: string | null, style: Style = DEFAULT_STYLE): Seg[] {
  const segs: Seg[] = [{ text: label, dim: true }, { text: ' ' }]
  // The plans size bars for a width of 10; the barWidth option scales them.
  const scaled = cells > 0 ? Math.max(2, Math.round((cells * style.barWidth) / 10)) : 0
  if (scaled > 0) segs.push(...barSegs(percent, scaled, tone, style), { text: ' ' })
  segs.push({ text: cells > 0 ? pct(percent).padStart(4) : pct(percent), tone })
  if (reset !== null) segs.push({ text: ` resets ${reset}`, dim: true })
  return segs
}

function identity(s: Snapshot, sep: string, withProject: boolean, withBranch: boolean): Seg[] {
  const segs: Seg[] = []
  if (s.model !== null) segs.push({ text: s.model, bold: true })
  if (withProject && s.project !== null) {
    if (segs.length > 0) segs.push({ text: sep, dim: true })
    segs.push({ text: s.project })
    if (withBranch && s.git !== null) {
      segs.push({ text: '  ' }, { text: s.git.branch, dim: true })
      if (s.git.isDirty) segs.push({ text: '●', tone: 'warning' })
    }
  }
  return segs
}

function memoryFree(m: Memory, suffix: boolean): Seg[] {
  return [{ text: 'mem', dim: true }, { text: ' ' }, { text: bytes(m.headroom), tone: memoryTone(m.headroom) }, ...(suffix ? [{ text: ' free', dim: true }] : [])]
}

// The `line` band: `Opus 5.5 │ my-app  main● │ ctx 42% │ 5h 61% │ 7d 44% │ mem 1.9G`. Fields drop
// from the right of the priority list (mem, 7d, the branch, the project, 5h, ctx) until the row fits.
export function lineRow(shown: Snapshot, columns: number): Row {
  const s = visible(shown)
  const five = windowOf(s, 'five_hour')
  const seven = windowOf(s, 'seven_day')
  const SEP: Seg = { text: ' │ ', dim: true }
  type Field = { key: string; segs: Seg[] }
  const build = (drop: ReadonlySet<string>): Row => {
    const fields: Field[] = []
    const id: Seg[] = []
    if (s.model !== null) id.push({ text: s.model, bold: true })
    if (id.length > 0) fields.push({ key: 'model', segs: id })
    if (s.project !== null && !drop.has('project')) {
      const p: Seg[] = [{ text: s.project }]
      if (s.git !== null && !drop.has('branch')) {
        p.push({ text: '  ' }, { text: s.git.branch, dim: true })
        if (s.git.isDirty) p.push({ text: '●', tone: 'warning' })
      }
      fields.push({ key: 'project', segs: p })
    }
    if (s.context !== null && !drop.has('ctx')) fields.push({ key: 'ctx', segs: meter('ctx', s.context, contextTone(s.context), 0, null) })
    if (five !== null && !drop.has('5h')) fields.push({ key: '5h', segs: meter('5h', five.percentUsed, limitTone(five.percentUsed), 0, null) })
    if (seven !== null && !drop.has('7d')) fields.push({ key: '7d', segs: meter('7d', seven.percentUsed, limitTone(seven.percentUsed), 0, null) })
    if (s.memory !== null && !drop.has('mem')) fields.push({ key: 'mem', segs: memoryFree(s.memory, false) })
    return fields.flatMap((f, i) => (i === 0 ? f.segs : [SEP, ...f.segs]))
  }
  const order = ['mem', '7d', 'branch', 'project', '5h', 'ctx']
  const drop = new Set<string>()
  let row = build(drop)
  for (const key of order) {
    if (width(row) <= columns) return row
    drop.add(key)
    row = build(drop)
  }
  return width(row) <= columns ? row : [{ text: cut(rowText(row), columns), bold: true }]
}

// The second panel row's variants, from the richest to the barest. The first that fits wins.
type MeterPlan = { ctx: number; five: number; seven: number; reset: boolean; mem: boolean; memSuffix: boolean; seven_: boolean }

const PLANS: readonly MeterPlan[] = [
  { ctx: 10, five: 10, seven: 10, reset: true, mem: true, memSuffix: true, seven_: true },
  { ctx: 8, five: 8, seven: 8, reset: true, mem: true, memSuffix: true, seven_: true },
  { ctx: 8, five: 8, seven: 8, reset: true, mem: true, memSuffix: false, seven_: true },
  { ctx: 10, five: 10, seven: 10, reset: true, mem: false, memSuffix: false, seven_: true },
  { ctx: 8, five: 8, seven: 8, reset: true, mem: false, memSuffix: false, seven_: true },
  { ctx: 8, five: 8, seven: 0, reset: true, mem: false, memSuffix: false, seven_: true },
  { ctx: 6, five: 6, seven: 0, reset: true, mem: false, memSuffix: false, seven_: true },
  { ctx: 6, five: 0, seven: 0, reset: true, mem: false, memSuffix: false, seven_: true },
  { ctx: 0, five: 0, seven: 0, reset: true, mem: false, memSuffix: false, seven_: true },
  { ctx: 0, five: 0, seven: 0, reset: false, mem: false, memSuffix: false, seven_: true },
  { ctx: 0, five: 0, seven: 0, reset: false, mem: false, memSuffix: false, seven_: false },
]

function metersRow(s: Snapshot, plan: MeterPlan): Row {
  const five = windowOf(s, 'five_hour')
  const seven = windowOf(s, 'seven_day')
  const st = s.style ?? DEFAULT_STYLE
  const groupsOf: Seg[][] = []
  if (s.context !== null) groupsOf.push(meter('ctx', s.context, contextTone(s.context), plan.ctx, null, st))
  if (five !== null) {
    const reset = plan.reset && five.resetsAt !== undefined ? resetIn(five.resetsAt, s.now) : null
    groupsOf.push(meter('5h', five.percentUsed, limitTone(five.percentUsed), plan.five, reset, st))
  }
  if (seven !== null && plan.seven_) groupsOf.push(meter('7d', seven.percentUsed, limitTone(seven.percentUsed), plan.seven, null, st))
  if (s.memory !== null && plan.mem) groupsOf.push(memoryFree(s.memory, plan.memSuffix))
  return groupsOf.flatMap((g, i) => (i === 0 ? g : [gap(3), ...g]))
}

// The `panel` band: identity and session figures on the first row, the meters on the second.
export function panelRows(shown: Snapshot, columns: number): Row[] {
  const s = visible(shown)
  const right: Seg[] = []
  if (s.startedAt !== null) right.push({ text: age(s.now - s.startedAt) })
  if (!(s.style?.hide.has('calls') ?? false)) {
    if (right.length > 0) right.push({ text: ' · ', dim: true })
    right.push({ text: `${s.calls} ${s.calls === 1 ? 'call' : 'calls'}` })
  }
  const rightShort: Seg[] = s.startedAt === null ? [] : [{ text: age(s.now - s.startedAt) }]

  let first: Row | null = null
  for (const [p, b] of [
    [true, true],
    [true, false],
    [false, false],
  ] as const) {
    const left = identity(s, ' · ', p, b)
    first = spread(left, right, columns) ?? (rightShort.length > 0 ? spread(left, rightShort, columns) : null)
    if (first === null && width(left) <= columns) first = left
    if (first !== null) break
  }
  const rows: Row[] = []
  if (first !== null && first.length > 0) rows.push(first)

  for (const plan of PLANS) {
    const row = metersRow(s, plan)
    if (width(row) <= columns) {
      if (row.length > 0) rows.push(row)
      break
    }
  }
  return rows
}

// ---------------------------------------------------------------------------------------------
// The activity block
// ---------------------------------------------------------------------------------------------

export type RunningTool = { name: string; detail: string; startedAt: number }
export type RunningAgent = { type: string; description: string; startedAt: number }

export type Activity = {
  now: number
  turnStartedAt: number
  // The main loop's latest tool still running, or null between tools.
  tool: RunningTool | null
  agents: readonly RunningAgent[]
  calls: number
  errors: number
  notable: string | null
}

// `mcp__claude_ai_Slack__slack_send_message` → `Slack slack_send_message`.
export function toolName(tool: string): string {
  if (!tool.startsWith('mcp__')) return tool
  const [server = '', ...rest] = tool.slice(5).split('__')
  return `${server.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '')} ${rest.join('__')}`.trim()
}

export function agentType(type: string): string {
  return type === 'general-purpose' ? 'general' : type
}

const DETAIL_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'description', 'url', 'query', 'skill', 'prompt'] as const

// The short input a tool row shows: the command, the file (relative to the project), the pattern...
export function toolDetail(input: unknown, cwd: string): string {
  if (typeof input !== 'object' || input === null) return ''
  for (const key of DETAIL_KEYS) {
    const v: unknown = Reflect.get(input, key)
    if (typeof v !== 'string' || v.trim() === '') continue
    let text = v.replace(/\s+/g, ' ').trim()
    if ((key === 'file_path' || key === 'notebook_path') && cwd !== '' && text.startsWith(cwd + '/')) text = text.slice(cwd.length + 1)
    return text
  }
  return ''
}

// A note another mod added to a tool result, shortened for the activity row.
export function notableOf(r: { deny?: string; context?: readonly string[] }): string | null {
  const texts = [...(r.context ?? []), ...(r.deny === undefined ? [] : [r.deny])]
  for (const t of texts) {
    if (t.includes('Loop check')) {
      if (t.includes('same error')) return 'loop-breaker: repeated error'
      if (t.includes('you have edited')) return 'loop-breaker: fix attempts'
      if (t.includes('same arguments')) return 'loop-breaker: repeated call'
      return 'loop-breaker: loop check'
    }
    if (t.includes('memory-guard mod ran the command with a single process')) return 'memory-guard: ran with 1 process'
    if (t.includes('memory-guard mod reran')) return 'memory-guard: reran after OOM'
    if (t.includes('memory-guard mod held')) return 'memory-guard: refused'
    if (t.includes('usage-limit mod')) return 'usage-limit: paused'
  }
  return null
}


// What the turn shows that Claude Code's own screen does not: the latest note another mod added to a
// tool result, which only the model reads. Claude Code already draws the running tool, its errors,
// the subagents and the turn's time, so the band leaves them out. No row while there is no note.
export function activityRows(a: Activity, columns: number): Row[] {
  const parts: Seg[][] = []
  if (a.notable !== null) parts.push([{ text: a.notable, tone: 'warning' }])
  if (parts.length === 0) return []
  const row: Row = parts.flatMap((p, i) => (i === 0 ? p : [{ text: ' · ', dim: true }, ...p]))
  return width(row) <= columns ? [row] : [[{ ...(row[0] ?? { text: '' }), text: cut(rowText(row), columns) }]]
}

// ---------------------------------------------------------------------------------------------
// Today's mod diaries
// ---------------------------------------------------------------------------------------------

export type Today = { skills: number; nudges: number; refusals: number }

export type DiaryFile = { mod: string; name: string; text: string }

function records(text: string): unknown[] {
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // a line cut by a crash mid-write
    }
  }
  return out
}

// The diary folders the TODAY row reads.
export const TODAY_MODS = ['skill-loader', 'loop-breaker', 'usage-limit', 'memory-guard'] as const

// The day in a diary's name (UTC, as the mods name them).
export function fileDay(name: string): string | null {
  return /^(\d{4}-\d{2}-\d{2})(?:-[\w-]+)?\.jsonl$/.exec(name)?.[1] ?? null
}

// A diary file can hold today's local lines when its UTC day is today or the day before.
export function mayHoldToday(name: string, today: string): boolean {
  const day = fileDay(name)
  if (day === null) return false
  const before = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)
  const after = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10)
  return day === today || day === before || day === after
}

export function countToday(files: readonly DiaryFile[], today: string, timeZone: string): Today {
  const t: Today = { skills: 0, nudges: 0, refusals: 0 }
  for (const f of files) {
    for (const r of records(f.text)) {
      if (typeof r !== 'object' || r === null) continue
      const at: unknown = Reflect.get(r, 'at')
      if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || localDay(Date.parse(at), timeZone) !== today) continue
      const event: unknown = Reflect.get(r, 'event')
      if (f.mod === 'skill-loader' && event === 'loaded') t.skills += 1
      else if (f.mod === 'loop-breaker' && event === 'nudge') t.nudges += 1
      else if (f.mod === 'usage-limit' && event === 'tool-refused') t.refusals += 1
      else if (f.mod === 'memory-guard' && event === 'refused') t.refusals += 1
    }
  }
  return t
}

// ---------------------------------------------------------------------------------------------
// The /hud pane
// ---------------------------------------------------------------------------------------------

export type PaneData = {
  snapshot: Snapshot
  activity: Activity | null
  today: Today | null
}

export type Section = { label: string; segs: Seg[] }

const DOT: Seg = { text: ' · ', dim: true }

function joined(parts: readonly Seg[][]): Seg[] {
  return parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : [DOT, ...p]))
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function paneSections(d: PaneData): Section[] {
  const s = d.snapshot
  const out: Section[] = []

  const session: Seg[][] = [identity(s, ' · ', true, true)]
  if (s.startedAt !== null) session.push([{ text: age(s.now - s.startedAt) }])
  session.push([{ text: plural(s.calls, 'call') }])
  if (s.context !== null) session.push([{ text: 'ctx ', dim: true }, { text: pct(s.context), tone: contextTone(s.context) }])
  out.push({ label: 'SESSION', segs: joined(session) })

  const limits: Seg[][] = []
  for (const [kind, label] of [
    ['five_hour', '5h'],
    ['seven_day', '7d'],
  ] as const) {
    const w = windowOf(s, kind)
    if (w === null) continue
    const reset = w.resetsAt === undefined ? null : resetIn(w.resetsAt, s.now)
    limits.push([{ text: `${label} `, dim: true }, { text: pct(w.percentUsed), tone: limitTone(w.percentUsed) }, ...(reset === null ? [] : [{ text: ` resets ${reset}`, dim: true }])])
  }
  if (limits.length > 0) out.push({ label: 'LIMITS', segs: joined(limits) })

  const m = s.memory
  if (m !== null) {
    const parts: Seg[][] = []
    if (m.session !== null && m.bound?.name !== 'session') parts.push([{ text: 'session ', dim: true }, { text: bytes(m.session) }])
    if (m.bound !== null) parts.push([{ text: `${m.bound.name} `, dim: true }, { text: ratio(m.bound.used, m.bound.limit) }])
    if (m.machine !== null) parts.push([{ text: 'machine ', dim: true }, { text: ratio(m.machine.total - m.machine.available, m.machine.total) }])
    parts.push([{ text: bytes(m.headroom), tone: memoryTone(m.headroom) }, { text: ' fits', dim: true }])
    out.push({ label: 'MEMORY', segs: joined(parts) })
  }

  const a = d.activity
  if (a !== null) {
    const now: Seg[][] = []
    if (a.tool !== null) now.push([{ text: a.tool.name, bold: true }, ...(a.tool.detail === '' ? [] : [{ text: ` ${cut(a.tool.detail, 40)}` }]), { text: ` ${clock(a.now - a.tool.startedAt)}`, dim: true }])
    else now.push([{ text: 'thinking', dim: true }, { text: ` ${clock(a.now - a.turnStartedAt)}`, dim: true }])
    if (a.agents.length > 0) now.push([{ text: plural(a.agents.length, 'subagent') }])
    out.push({ label: 'NOW', segs: joined(now) })
  } else {
    out.push({ label: 'NOW', segs: [{ text: 'idle', dim: true }] })
  }

  const t = d.today
  if (t !== null) {
    const item = (n: number, one: string, many?: string): Seg[] => [{ text: plural(n, one, many), ...(n === 0 ? { dim: true } : {}) }]
    out.push({ label: 'TODAY', segs: joined([item(t.skills, 'skill'), item(t.nudges, 'loop nudge'), item(t.refusals, 'refusal')]) })
  }
  return out
}

export const LABEL_WIDTH = 10

// The pane as plain lines, for Remote Control.
export function paneText(sections: readonly Section[]): string {
  return sections.map((x) => `${x.label.padEnd(LABEL_WIDTH)}${rowText(x.segs)}`).join('\n')
}

// ---------------------------------------------------------------------------------------------
// The status line under the prompt
// ---------------------------------------------------------------------------------------------

// What the mod leaves for the status line script, one file per session: the figures only the mods
// API sees. The script reads the rest from the JSON Claude Code pipes to it.
export type Live = { calls: number; startedAt: number | null }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function field(v: unknown, ...path: string[]): unknown {
  let at = v
  for (const key of path) {
    if (typeof at !== 'object' || at === null) return undefined
    at = Reflect.get(at, key)
  }
  return at
}

// The session id in the status line's JSON, or null.
export function statusSession(input: unknown): string | null {
  const id = field(input, 'session_id')
  return typeof id === 'string' && /^[\w-]{1,128}$/.test(id) ? id : null
}

export function parseLive(text: string): Live | null {
  try {
    const v: unknown = JSON.parse(text)
    const calls = num(field(v, 'calls'))
    return calls === null ? null : { calls, startedAt: num(field(v, 'startedAt')) }
  } catch {
    return null
  }
}

// The context fill: the status line's own percentage, or the last response's input tokens over the
// window while the percentage is still missing.
// With a compaction window under the model's window, the fill is measured against the compaction
// window, so 100% reads as where auto-compaction runs.
function contextOf(input: unknown, compactWindow: number | null): number | null {
  const size = num(field(input, 'context_window', 'context_window_size'))
  const pct = num(field(input, 'context_window', 'used_percentage'))
  let tokens: number | null = null
  if (pct !== null && size !== null && size > 0) tokens = (pct / 100) * size
  else {
    const usage = field(input, 'context_window', 'current_usage')
    if (typeof usage === 'object' && usage !== null) {
      const sum = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((n, k) => n + (num(field(usage, k)) ?? 0), 0)
      if (sum > 0) tokens = sum
    }
  }
  if (tokens === null) return pct
  const base = compactWindow !== null && compactWindow > 0 && (size === null || compactWindow < size) ? compactWindow : size
  return base === null || base <= 0 ? pct : Math.min(100, (tokens / base) * 100)
}

// The auto-compact window in tokens, as Claude Code settles it: the CLAUDE_CODE_AUTO_COMPACT_WINDOW
// variable over the autoCompactWindow setting. Null when neither holds a number of 100000 or more.
export function compactWindowOf(env: string | undefined, setting: unknown): number | null {
  const fromEnv = env === undefined || !/^\d+$/.test(env.trim()) ? null : Number(env.trim())
  const value = fromEnv ?? num(setting)
  return value === null ? null : Math.min(1_000_000, Math.max(100_000, value))
}

function windowsOf(input: unknown): Window[] {
  const out: Window[] = []
  for (const kind of ['five_hour', 'seven_day']) {
    const used = num(field(input, 'rate_limits', kind, 'used_percentage'))
    if (used === null) continue
    const reset = num(field(input, 'rate_limits', kind, 'resets_at'))
    out.push(reset === null ? { kind, percentUsed: used } : { kind, percentUsed: used, resetsAt: new Date(reset * 1000).toISOString() })
  }
  return out
}

// The snapshot the status line draws: the status line's JSON, the mod's live file, and what the
// script read itself (git, memory).
export function statusSnapshot(
  input: unknown,
  live: Live | null,
  read: { now: number; timeZone: string; git: Git | null; memory: Memory | null; compactWindow?: number | null; style?: Style },
): Snapshot {
  const id = field(input, 'model', 'id')
  const name = field(input, 'model', 'display_name')
  const dir = field(input, 'workspace', 'current_dir') ?? field(input, 'cwd')
  const duration = num(field(input, 'cost', 'total_duration_ms'))
  return {
    now: read.now,
    timeZone: read.timeZone,
    model: typeof id === 'string' && id !== '' ? modelName(id) : typeof name === 'string' && name !== '' ? name : null,
    project: typeof dir === 'string' && dir !== '' ? basename(dir) : null,
    git: read.git,
    startedAt: live?.startedAt ?? (duration === null ? null : read.now - duration),
    calls: live?.calls ?? 0,
    context: contextOf(input, read.compactWindow ?? null),
    windows: windowsOf(input),
    memory: read.memory,
    ...(read.style === undefined ? {} : { style: read.style }),
  }
}

const HUES: Record<Hue, string> = { branch: '35', ahead: '36', behind: '31', pr: '34', accent: '35' }
const CHIPS = { strong: '48;5;239', soft: '48;5;236' } as const

const BASIC: Record<string, number> = { black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90, grey: 90 }

// A color of the `colors` option as an SGR code: `green` → 32, `bright-green` → 92, `#ff8800` →
// 38;2;255;136;0, `208` → 38;5;208.
export function sgrColor(c: string): string {
  const name = c.toLowerCase()
  if (name.startsWith('bright-')) {
    const base = BASIC[name.slice(7)]
    if (base !== undefined) return String(base === 90 ? 97 : base + 60)
  }
  const basic = BASIC[name]
  if (basic !== undefined) return String(basic)
  if (/^#[0-9a-f]{6}$/i.test(c)) return `38;2;${parseInt(c.slice(1, 3), 16)};${parseInt(c.slice(3, 5), 16)};${parseInt(c.slice(5, 7), 16)}`
  if (/^\d{1,3}$/.test(c) && Number(c) <= 255) return `38;5;${c}`
  return '39'
}

// A row as terminal text with SGR colors, each segment reset after itself.
export function ansiRow(row: readonly Seg[], colors: Record<Tone, string> = DEFAULT_STYLE.colors): string {
  return row
    .map((s) => {
      const codes = [
        ...(s.bold === true ? ['1'] : []),
        ...(s.dim === true ? ['2'] : []),
        ...(s.italic === true ? ['3'] : []),
        ...(s.rgb !== undefined ? [`38;2;${s.rgb.join(';')}`] : s.tone !== undefined ? [sgrColor(colors[s.tone])] : s.hue !== undefined ? [HUES[s.hue]] : []),
        ...(s.chip === undefined ? [] : [CHIPS[s.chip]]),
      ]
      return codes.length === 0 ? s.text : `\x1b[${codes.join(';')}m${s.text}\x1b[0m`
    })
    .join('')
}
