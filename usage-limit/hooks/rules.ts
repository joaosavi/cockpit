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

// One stage of a window: whether it acts, and from which percentage.
export type Stage = { on: boolean; at: number }

// The three stages of a window. `throttle`: one subagent at a time. `commit`: the agent is asked once per
// window to commit its work in progress, without pushing. `pause`: the session stops calling tools, so
// the rest of the window stays the user's.
export type Limits = { throttle: Stage; commit: Stage; pause: Stage }

// The two groups of windows with their own limits. A per-model weekly window, such as `seven_day_opus`,
// follows `sevenDay`.
export type Group = 'fiveHour' | 'sevenDay'

export type Options = {
  fiveHour: Limits
  sevenDay: Limits
  // Time zone of the times the agent and the user read.
  timeZone: string
  // Resumes the session when the window resets, after the pause or after the limit error (a burst of
  // parallel requests can jump past the pause). Off, the user resumes it.
  resume: boolean
  // From this percentage of the fullest window, the band above the prompt shows the windows.
  bandFrom: number
}

// 10% of the 7-day window is a lot of work on the bigger plans, so it throttles and pauses later than
// the 5-hour one. The commit comes one point before each pause.
export const DEFAULTS: Options = {
  fiveHour: { throttle: { on: true, at: 90 }, commit: { on: true, at: 97 }, pause: { on: true, at: 98 } },
  sevenDay: { throttle: { on: true, at: 97 }, commit: { on: true, at: 98 }, pause: { on: true, at: 99 } },
  timeZone: '',
  resume: true,
  bandFrom: 75,
}

// Margin after the reset time, because the server can release the limit a few seconds late.
export const MARGIN_MS = 2 * 60_000

const STAGES = ['throttle', 'commit', 'pause'] as const
type StageName = (typeof STAGES)[number]

// The option names of a stage: `fiveHourThrottle` switches it, `fiveHourThrottleAt` sets its percentage.
function stageKey(group: Group, stage: StageName): string {
  return `${group}${stage.charAt(0).toUpperCase()}${stage.slice(1)}`
}

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const get = (key: string): unknown => Reflect.get(values, key)
  const number = (key: string): number | undefined => {
    const v = get(key)
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }
  const timeZone = get('timeZone')
  // `resumeOnError` is the option's name before 1.5, kept so older settings still apply.
  const resume = get('resume') ?? get('resumeOnError')
  // The options before 1.2 set every window alike: `alert` throttles, `commitAt` commits (0 off) and
  // `reserve` pauses at 100 minus it. They apply to a stage whose own options are unset.
  const reserve = number('reserve')
  const commitAt = number('commitAt')
  const legacy: Record<StageName, number | undefined> = {
    throttle: number('alert'),
    commit: commitAt === 0 ? undefined : commitAt,
    pause: reserve === undefined ? undefined : 100 - reserve,
  }
  const limits = (group: Group): Limits => {
    const stage = (name: StageName): Stage => {
      const key = stageKey(group, name)
      const at = number(`${key}At`)
      const on = get(key)
      return {
        on: typeof on === 'boolean' ? on : !(name === 'commit' && at === undefined && commitAt === 0),
        at: at ?? legacy[name] ?? DEFAULTS[group][name].at,
      }
    }
    return { throttle: stage('throttle'), commit: stage('commit'), pause: stage('pause') }
  }
  const bandFrom = number('bandFrom')
  return {
    fiveHour: limits('fiveHour'),
    sevenDay: limits('sevenDay'),
    timeZone: typeof timeZone === 'string' ? validTimeZone(timeZone.trim()) : DEFAULTS.timeZone,
    resume: typeof resume === 'boolean' ? resume : DEFAULTS.resume,
    bandFrom: bandFrom ?? DEFAULTS.bandFrom,
  }
}

export function group(kind: string): Group {
  return kind.startsWith('five_hour') ? 'fiveHour' : 'sevenDay'
}

export function limitsFor(window: Window, o: Pick<Options, Group>): Limits {
  return o[group(window.kind)]
}

// Whether a window has reached a stage that is on.
export function reached(window: Window, stage: Stage): boolean {
  return stage.on && window.percentUsed >= stage.at
}

// The fullest window, the one the limit error reports.
export function fullest(windows: readonly Window[]): Window | null {
  return windows.reduce<Window | null>((a, w) => (a === null || w.percentUsed > a.percentUsed ? w : a), null)
}

function resetMs(w: Window): number {
  return w.resetsAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(w.resetsAt)
}

// Each window is judged by its own limits, and the most restrictive result applies, because any window
// reaching 100% stops the account. Among paused windows, the one that resets last holds the session,
// so the resume does not wake into a window still paused.
export function classify(windows: readonly Window[], o: Pick<Options, Group>): Zone {
  const paused = windows.filter((w) => reached(w, limitsFor(w, o).pause))
  const last = paused.reduce<Window | null>((a, w) => (a === null || resetMs(w) > resetMs(a) ? w : a), null)
  if (last !== null) return { kind: 'paused', window: last }
  const throttled = fullest(windows.filter((w) => reached(w, limitsFor(w, o).throttle)))
  if (throttled !== null) return { kind: 'throttled', window: throttled }
  return { kind: 'free' }
}

// The window to commit before: past its own commit stage and short of its own pause.
export function commitDue(windows: readonly Window[], o: Pick<Options, Group>): Window | null {
  return fullest(
    windows.filter((w) => {
      const l = limitsFor(w, o)
      return reached(w, l.commit) && !reached(w, l.pause)
    }),
  )
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

export function commitText(window: Window, o: Pick<Options, Group>): string {
  const pause = limitsFor(window, o).pause
  const ahead = pause.on ? `the session pauses at ${pause.at}%` : 'the limit stops the session at 100%'
  return (
    `usage-limit: the ${windowName(window.kind)} is at ${window.percentUsed}%, and ${ahead}. ` +
    'At the next safe point, commit the work in progress in each git repository you changed in this session, ' +
    'with a message that starts with `wip:`. Stage only the files you changed, by name, not `git add -A`: another ' +
    'session may be editing the same repository. Do not push. If a pre-commit hook fails on the unfinished work, ' +
    'commit with `--no-verify`. If you changed nothing, skip it. Then carry on.'
  )
}

// A command that only stages and commits, chained with `&&`: the one Bash call the pause lets through, so
// the work gets committed even when a burst of requests jumps from below the commit stage straight to the pause.
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

// The share of a window the pause keeps for the user.
export function reserveOf(window: Window, o: Pick<Options, Group>): number {
  return Math.max(0, 100 - limitsFor(window, o).pause.at)
}

export function pauseText(window: Window, o: Options): string {
  return (
    `usage-limit: paused at ${window.percentUsed}% of the ${windowName(window.kind)}, to keep the user's ${reserveOf(window, o)}% reserve. ` +
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

export function throttledSubagentText(window: Window, o: Pick<Options, Group>): string {
  return (
    `usage-limit: the ${windowName(window.kind)} is at ${window.percentUsed}%, and from ${limitsFor(window, o).throttle.at}% only one subagent runs at a time. ` +
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
      return `paused at ${zone.window.percentUsed}% of the ${windowName(zone.window.kind)} (${reserveOf(zone.window, o)}% reserve), ${back}`
    }
    case 'throttled':
      return `throttled at ${zone.window.percentUsed}% of the ${windowName(zone.window.kind)}, one subagent at a time from ${limitsFor(zone.window, o).throttle.at}%`
    case 'free':
      return 'normal'
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

// A window's stages in plain words: `one subagent from 90%, commit at 97%, pause at 98%`.
export function stagesText(l: Limits): string {
  const parts = [
    l.throttle.on ? `One subagent from ${l.throttle.at}%` : 'No subagent limit',
    l.commit.on ? `commit at ${l.commit.at}%` : 'no commit request',
    l.pause.on ? `pause at ${l.pause.at}%` : 'no pause',
  ]
  return parts.join(', ')
}

// What the mod is holding for the resume, as /limit reports it.
export type Pending = { isResumeScheduled: boolean; held: number }

// The /limit reply: plain lines, so it reads the same in Remote Control. Claude Code already puts
// `usage-limit:` in front of a command's text, so the reply starts with the state itself.
export function limitReport(windows: readonly Window[], zone: Zone, o: Options, pending: Pending): string {
  if (windows.length === 0) return 'No reading yet. It arrives with the first model response.'
  const lines = windows.map((w) => {
    const back = w.resetsAt === undefined ? '' : `, resets ${formatTime(w.resetsAt, o.timeZone)}`
    return `${windowName(w.kind)}: ${w.percentUsed}%${back}. ${stagesText(limitsFor(w, o))}`
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

// Theme colors, by the window's own limits: green before its first stage, yellow from the throttle or
// the commit, red from the pause.
export type Tone = 'success' | 'warning' | 'error'

export function tone(window: Window, o: Pick<Options, Group>): Tone {
  const l = limitsFor(window, o)
  if (reached(window, l.pause)) return 'error'
  if (reached(window, l.throttle) || reached(window, l.commit)) return 'warning'
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
    runs: bar(width, r.w.percentUsed, limitsFor(r.w, o).pause.on ? limitsFor(r.w, o).pause.at : null),
    tone: tone(r.w, o),
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
