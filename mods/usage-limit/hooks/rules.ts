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
  // Also resumes a session that hit 100% with the limit error, when the pause at the reserve came
  // too late (a burst of parallel requests can jump past it).
  resumeOnError: boolean
}

export const DEFAULTS: Options = { reserve: 2, alert: 90, timeZone: 'America/Sao_Paulo', resumeOnError: true }

// Margin after the reset time, because the server can release the limit a few seconds late.
export const MARGIN_MS = 2 * 60_000

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const number = (key: string, fallback: number): number => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const timeZone: unknown = Reflect.get(values, 'timeZone')
  const resume: unknown = Reflect.get(values, 'resumeOnError')
  return {
    reserve: number('reserve', DEFAULTS.reserve),
    alert: number('alert', DEFAULTS.alert),
    timeZone: typeof timeZone === 'string' && timeZone !== '' ? timeZone : DEFAULTS.timeZone,
    resumeOnError: typeof resume === 'boolean' ? resume : DEFAULTS.resumeOnError,
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

const NAMES: Record<string, string> = { five_hour: '5-hour window', seven_day: '7-day window' }

export function windowName(kind: string): string {
  return NAMES[kind] ?? kind
}

export function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function msUntilReset(window: Window, now: number): number | null {
  if (window.resetsAt === undefined) return null
  return Math.max(0, Date.parse(window.resetsAt) - now) + MARGIN_MS
}

export function pauseText(window: Window, o: Options): string {
  const back = window.resetsAt === undefined ? 'when the limit resets' : `at ${formatTime(window.resetsAt, o.timeZone)}`
  return (
    `Paused by the usage-limit mod: the account's ${windowName(window.kind)} is at ${window.percentUsed}%, ` +
    `and the last ${o.reserve}% are kept in reserve for the user. Do not call any more tools. ` +
    `Write in up to 3 lines where you stopped and what is left. The session resumes on its own ${back}.`
  )
}

export function reserveTurnText(window: Window): string {
  return (
    `The account usage limit is at ${window.percentUsed}% (${windowName(window.kind)}), ` +
    "and this turn spends the user's reserve. Answer directly, without subagents, and read only the part you need."
  )
}

export function resumeText(window: Window, queue: readonly string[]): string {
  const base =
    `This session paused when the usage limit's ${windowName(window.kind)} reached ` +
    `${window.percentUsed}%, to keep the user's reserve. The limit has reset. Continue where you left off, ` +
    'with at most one subagent at a time, reading excerpts instead of whole files.'
  if (queue.length === 0) return base
  const received = queue.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `${base}\n\nThese messages arrived during the pause and were held:\n${received}`
}

export function summary(windows: readonly Window[], zone: Zone, o: Options): string {
  if (windows.length === 0) return 'no reading yet. The first model response carries the percentage.'
  const lines = windows.map((w) => {
    const back = w.resetsAt === undefined ? '' : `, resets ${formatTime(w.resetsAt, o.timeZone)}`
    return `${windowName(w.kind)}: ${w.percentUsed}%${back}`
  })
  const state =
    zone.kind === 'paused'
      ? `paused at ${100 - o.reserve}%`
      : zone.kind === 'throttled'
        ? `throttled above ${o.alert}%, one subagent at a time`
        : 'free'
  return [state, ...lines].join('\n')
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
