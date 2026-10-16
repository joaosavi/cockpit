// The rules of the usage-limit mod, without the mods API, so the tests can run them directly.

export type Window = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type Zone =
  | { kind: 'free' }
  | { kind: 'throttled'; window: Window }
  | { kind: 'paused'; window: Window }

export type Options = {
  // Below 100 - reserve, the session works. Above it, it pauses.
  reserve: number
  // Above this percentage, only one subagent runs at a time.
  alert: number
  // Time zone of the times the agent and the user read.
  timeZone: string
  // From this percentage, the agent is asked once per window to commit its work in progress, without
  // pushing, before the pause. 0 turns it off.
  commitAt: number
  // Resumes the session when the window resets, after the pause or after the limit error (a burst of
  // parallel requests can jump past the pause). Off, the user resumes it.
  resume: boolean
  // From this percentage of the fullest window, the band above the prompt shows the windows.
  bandFrom: number
}

export const DEFAULTS: Options = { reserve: 2, alert: 90, timeZone: '', commitAt: 97, resume: true, bandFrom: 75 }

// Margin after the reset time, because the server can release the limit a few seconds late.
export const MARGIN_MS = 2 * 60_000

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const number = (key: string, fallback: number): number => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const timeZone: unknown = Reflect.get(values, 'timeZone')
  // `resumeOnError` is the option's name before 1.5, kept so older settings still apply.
  const resume: unknown = Reflect.get(values, 'resume') ?? Reflect.get(values, 'resumeOnError')
  return {
    reserve: number('reserve', DEFAULTS.reserve),
    alert: number('alert', DEFAULTS.alert),
    timeZone: typeof timeZone === 'string' ? validTimeZone(timeZone.trim()) : DEFAULTS.timeZone,
    commitAt: number('commitAt', DEFAULTS.commitAt),
    resume: typeof resume === 'boolean' ? resume : DEFAULTS.resume,
    bandFrom: number('bandFrom', DEFAULTS.bandFrom),
  }
}

// The fullest window decides the zone, because any of them reaching 100% stops the account.
export function fullest(windows: readonly Window[]): Window | null {
  return windows.reduce<Window | null>((a, w) => (a === null || w.percentUsed > a.percentUsed ? w : a), null)
}

export function classify(windows: readonly Window[], o: Pick<Options, 'reserve' | 'alert'>): Zone {
  const full = fullest(windows)
  if (full === null) return { kind: 'free' }
  if (full.percentUsed >= 100 - o.reserve) return { kind: 'paused', window: full }
  if (full.percentUsed >= o.alert) return { kind: 'throttled', window: full }
  return { kind: 'free' }
}

// The window to commit before, when the fullest one is past `commitAt` and short of the pause.
export function commitDue(windows: readonly Window[], o: Pick<Options, 'commitAt' | 'reserve'>): Window | null {
  const full = fullest(windows)
  if (full === null || o.commitAt <= 0) return null
  return full.percentUsed >= o.commitAt && full.percentUsed < 100 - o.reserve ? full : null
}

// One request to commit per window and reset time: the next cycle of the same window asks again.
export function commitKey(window: Window): string {
  return `${window.kind}@${window.resetsAt ?? ''}`
}

const NAMES: Record<string, string> = { five_hour: '5-hour window', seven_day: '7-day window' }

// An unknown kind, such as a per-model weekly window, reads as its words: `seven_day_opus` → `seven day opus window`.
export function windowName(kind: string): string {
  return NAMES[kind] ?? `${kind.replace(/_/g, ' ')} window`
}

// A time zone the runtime knows, or empty for the system's own. An unknown name falls back to empty
// instead of throwing on every time shown.
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

export function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', { ...zone(timeZone), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function msUntilReset(window: Window, now: number): number | null {
  if (window.resetsAt === undefined) return null
  return Math.max(0, Date.parse(window.resetsAt) - now) + MARGIN_MS
}

export function commitText(window: Window, o: Pick<Options, 'reserve'>): string {
  return (
    `usage-limit: the ${windowName(window.kind)} is at ${window.percentUsed}%, and the session pauses at ${100 - o.reserve}%. ` +
    'At the next safe point, commit the work in progress in each git repository you changed in this session, ' +
    'with a message that starts with `wip:`. Stage only the files you changed, by name, not `git add -A`: another ' +
    'session may be editing the same repository. Do not push. If a pre-commit hook fails on the unfinished work, ' +
    'commit with `--no-verify`. If you changed nothing, skip it. Then carry on.'
  )
}

// A command that only stages and commits, chained with `&&`: the one Bash call the pause lets through, so
// the work gets committed even when a burst of requests jumps from below `commitAt` straight to the pause.
// Anything that pushes, pipes, substitutes or runs another program is refused like any other tool.
const COMMIT_STEP = /^(cd [^\s;&|`$()<>]+|git( -C [^\s;&|`$()<>]+)? (add|commit|status)( [^;&|`$<>]*)?)$/

export function isCommitCommand(command: string): boolean {
  if (/\bpush\b/.test(command) || command.includes('\n')) return false
  const steps = command.split('&&').map((p) => p.trim())
  return steps.some((p) => /^git\b/.test(p) && / commit\b/.test(p)) && steps.every((p) => COMMIT_STEP.test(p))
}

// When the session comes back, in the agent's words.
function backText(window: Window, o: Pick<Options, 'timeZone' | 'resume'>): string {
  if (!o.resume) return 'The session does not resume on its own: the user resumes it.'
  const back = window.resetsAt === undefined ? 'when the limit resets' : `at ${formatTime(window.resetsAt, o.timeZone)}`
  return `The session resumes ${back}.`
}

export function pauseText(window: Window, o: Options): string {
  return (
    `usage-limit: paused at ${window.percentUsed}% of the ${windowName(window.kind)}, to keep the user's ${o.reserve}% reserve. ` +
    'Stop calling tools. If the work in progress is not committed yet, commit it first in each git repository you ' +
    'changed (`git add` of the files you changed and `git commit` only, message starting with `wip:`, `--no-verify` if a hook fails; do not push). ' +
    `Then write in up to 3 lines where you stopped and what is left. ${backText(window, o)}`
  )
}

export function reserveTurnText(window: Window): string {
  return (
    `usage-limit: the ${windowName(window.kind)} is at ${window.percentUsed}% and this turn spends the user's reserve. ` +
    'Answer directly, without subagents, reading only the parts of files you need.'
  )
}

export function reserveSubagentText(): string {
  return 'usage-limit: no subagents in the reserve. Do the task directly, reading only the parts you need.'
}

export function throttledSubagentText(window: Window, o: Pick<Options, 'alert'>): string {
  return (
    `usage-limit: usage at ${window.percentUsed}%, and from ${o.alert}% only one subagent runs at a time. ` +
    'Wait for the running one or do the task directly.'
  )
}

export function heldText(window: Window, o: Pick<Options, 'timeZone'>): string {
  const back = window.resetsAt === undefined ? 'when the limit resets' : `at ${formatTime(window.resetsAt, o.timeZone)}`
  return `usage-limit: held during the reserve, delivered when the session resumes ${back}.`
}

// An automatic prompt during the pause when resume is off: nothing would ever deliver it.
export function droppedText(): string {
  return 'usage-limit: paused, and resume is off, so this message was not delivered.'
}

export function resumeText(window: Window, queue: readonly string[]): string {
  const base =
    `usage-limit: the limit reset. This session paused at ${window.percentUsed}% of the ${windowName(window.kind)}. ` +
    'Continue where you left off, one subagent at a time, reading excerpts instead of whole files.'
  if (queue.length === 0) return base
  const received = queue.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `${base}\n\nHeld during the pause:\n${received}`
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The state in plain words, after `Usage limit: ` in /limit and in the status line.
export function stateText(zone: Zone, o: Options): string {
  switch (zone.kind) {
    case 'paused': {
      const at = zone.window.resetsAt
      const back = !o.resume ? 'resume off' : at === undefined ? 'no reset time' : `resumes ${formatTime(at, o.timeZone)}`
      return `paused at ${zone.window.percentUsed}% (${o.reserve}% reserve), ${back}`
    }
    case 'throttled':
      return `throttled at ${zone.window.percentUsed}%, one subagent at a time from ${o.alert}%`
    case 'free':
      return `normal, one subagent at a time from ${o.alert}%, pause at ${100 - o.reserve}%`
    default: {
      const exhaustive: never = zone
      return exhaustive
    }
  }
}

// The status line under the prompt, shown only while the mod holds something back.
export function statusText(zone: Zone, o: Options): string | undefined {
  return zone.kind === 'free' ? undefined : `Usage limit: ${stateText(zone, o)}`
}

// What the mod is holding for the resume, as /limit reports it.
export type Pending = { isResumeScheduled: boolean; held: number }

// The /limit reply: plain lines, so it reads the same in Remote Control. Claude Code already puts
// `usage-limit:` in front of a command's text, so the reply starts with the state itself.
export function limitReport(windows: readonly Window[], zone: Zone, o: Options, pending: Pending): string {
  if (windows.length === 0) return 'No reading yet. It arrives with the first model response.'
  const lines = windows.map((w) => {
    const back = w.resetsAt === undefined ? '' : `, resets ${formatTime(w.resetsAt, o.timeZone)}`
    return `${windowName(w.kind)}: ${w.percentUsed}%${back}`
  })
  if (pending.isResumeScheduled) lines.push('Resume scheduled for the window reset.')
  if (pending.held > 0) lines.push(`${plural(pending.held, 'message')} held for the resume.`)
  const state = stateText(zone, o)
  return [state.charAt(0).toUpperCase() + state.slice(1), ...lines].join('\n')
}

// What arrives without anyone typing: routine, task notification, another session, MCP channel,
// another plugin. These are held for the resume. Everything else counts as the user's and uses the
// reserve, including an origin Claude Code could not classify: spending a bit of the reserve costs
// less than swallowing one of the user's messages.
const AUTOMATIC_ORIGINS = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'plugin',
])

export function isAutomatic(origin: { kind: string } | undefined): boolean {
  return origin !== undefined && AUTOMATIC_ORIGINS.has(origin.kind)
}

export type Reading = { at: number; windows: Window[] }

function isWindow(v: unknown): v is Window {
  if (typeof v !== 'object' || v === null) return false
  const kind: unknown = Reflect.get(v, 'kind')
  const pct: unknown = Reflect.get(v, 'percentUsed')
  const reset: unknown = Reflect.get(v, 'resetsAt')
  return typeof kind === 'string' && typeof pct === 'number' && (reset === undefined || typeof reset === 'string')
}

// The reading another session stored. A window that already reset is dropped, because its percentage is back to zero.
export function reading(v: unknown, now: number): Reading | null {
  if (typeof v !== 'object' || v === null) return null
  const at: unknown = Reflect.get(v, 'at')
  const list: unknown = Reflect.get(v, 'windows')
  if (typeof at !== 'number' || !Array.isArray(list)) return null
  const windows = withoutExpired(list.filter(isWindow), now)
  return { at, windows }
}

// Drops the windows whose reset time has passed, because their percentage is back to zero.
export function withoutExpired(windows: readonly Window[], now: number): Window[] {
  return windows.filter((w) => w.resetsAt === undefined || Date.parse(w.resetsAt) > now)
}

// The band above the prompt shows when the fullest window reaches `bandFrom`, or the mod is holding something back.
export function showsBand(windows: readonly Window[], zone: Zone, o: Pick<Options, 'bandFrom'>): boolean {
  const full = fullest(windows)
  if (full === null) return false
  return zone.kind !== 'free' || full.percentUsed >= o.bandFrom
}

// Theme colors: green below the alert, yellow from the alert, red from the pause.
export type Tone = 'success' | 'warning' | 'error'

export function tone(percent: number, o: Pick<Options, 'alert' | 'reserve'>): Tone {
  if (percent >= 100 - o.reserve) return 'error'
  if (percent >= o.alert) return 'warning'
  return 'success'
}

// A run of equal cells of a bar: used (`█`), free (`░`), or the pause mark (`│`).
export type Run = { kind: 'fill' | 'empty' | 'mark'; text: string }

const CHAR: Record<Run['kind'], string> = { fill: '█', empty: '░', mark: '│' }

export function bar(width: number, percent: number, markAt: number | null): Run[] {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))
  const mark = markAt === null ? -1 : Math.min(width - 1, Math.max(0, Math.round((markAt / 100) * width)))
  const runs: Run[] = []
  for (let i = 0; i < width; i++) {
    const kind: Run['kind'] = i === mark ? 'mark' : i < filled ? 'fill' : 'empty'
    const last = runs.at(-1)
    if (last !== undefined && last.kind === kind) last.text += CHAR[kind]
    else runs.push({ kind, text: CHAR[kind] })
  }
  return runs
}

const SHORT_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day' }

// One row of the band: the window's name, its bar, the percent and the reset time.
export type BandRow = { label: string; runs: Run[]; tone: Tone; percent: string; reset: string }

// The widest the bar gets, so the rows read as a compact block instead of spanning the whole terminal.
export const BAR_MAX = 40

// The band's rows, one per window. Every row gets the same bar width, so the pause marks, the percents
// and the reset times line up in columns.
export function bandRows(windows: readonly Window[], columns: number, o: Options): BandRow[] {
  const rows = windows.map((w) => {
    const name = SHORT_NAMES[w.kind] ?? w.kind
    return {
      w,
      label: name.padEnd(Math.max(7, name.length + 1)),
      percent: `${Math.round(w.percentUsed)}%`.padStart(5),
      reset: w.resetsAt === undefined ? '' : `  resets ${formatTime(w.resetsAt, o.timeZone)}`,
    }
  })
  const labelWidth = Math.max(0, ...rows.map((r) => r.label.length))
  const resetWidth = Math.max(0, ...rows.map((r) => r.reset.length))
  let width = columns - labelWidth - 5 - resetWidth
  const showReset = width >= 10
  if (!showReset) width = columns - labelWidth - 5
  width = Math.max(5, Math.min(BAR_MAX, width))
  return rows.map((r) => ({
    label: r.label.padEnd(labelWidth),
    runs: bar(width, r.w.percentUsed, 100 - o.reserve),
    tone: tone(r.w.percentUsed, o),
    percent: r.percent,
    reset: showReset ? r.reset : '',
  }))
}

// The band's last row while paused.
export function pausedText(zone: Zone, o: Pick<Options, 'timeZone' | 'resume'>): string | null {
  if (zone.kind !== 'paused') return null
  if (!o.resume) return 'Paused: resume off'
  const at = zone.window.resetsAt
  return at === undefined ? 'Paused: no reset time' : `Paused: resumes ${formatTime(at, o.timeZone)}`
}
