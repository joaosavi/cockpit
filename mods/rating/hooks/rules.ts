// The rating mod's rules, with no mods API, so the tests run them directly.

export type Options = {
  // Folder of the dataset. A leading ~ is the home folder.
  datasetDir: string
  // Draw the rating row above the prompt after each answer.
  band: boolean
  // Git repo whose short HEAD commit each turn records as `configVersion`, such as the repo that holds
  // your Claude Code settings. Empty records none.
  configRepo: string
}

export const DEFAULTS: Options = { datasetDir: '~/datasets/agent-ratings', band: true, configRepo: '' }

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const dir: unknown = Reflect.get(values, 'datasetDir')
  const band: unknown = Reflect.get(values, 'band')
  const repo: unknown = Reflect.get(values, 'configRepo')
  return {
    datasetDir: typeof dir === 'string' && dir.trim() !== '' ? dir.trim() : DEFAULTS.datasetDir,
    band: typeof band === 'boolean' ? band : DEFAULTS.band,
    configRepo: typeof repo === 'string' ? repo.trim() : DEFAULTS.configRepo,
  }
}

export function expandHome(path: string, home: string | undefined): string | null {
  if (path === '~' || path.startsWith('~/')) return home === undefined ? null : home + path.slice(1)
  return path
}

// ---------------------------------------------------------------------------------------------
// Records

export type Outcome = 'ok' | 'error' | 'denied'

export type ToolRecord = {
  tool: string
  agentId?: string
  input: Record<string, string>
  outcome: Outcome
  output: string
  ms: number
  nudged?: true
}

export type Usage = Readonly<Record<string, unknown>>

export type TurnRecord = {
  v: 1
  id: string
  session: string
  at: string
  endedAt: string
  cwd: string
  project: string
  model: string
  origin: string
  prompt: string
  answer: string
  aborted: boolean
  durationMs: number
  usage: Usage | null
  tools: ToolRecord[]
  skills: string[]
  configVersion: string | null
}

export type RatingRecord = {
  v: 1
  turn: string
  score: number
  tags: string[]
  comment?: string
  at: string
  source: 'user'
}

export type Signals = {
  aborted: boolean
  retried: boolean
  correction: boolean
  approval: boolean
  loopNudges: number
  toolErrors: number
  refusals: number
}

export type SignalRecord = {
  v: 1
  turn: string
  at: string
  signals: Signals
  implicitScore: number
  source: 'implicit'
}

export function turnId(sessionId: string, turn: string): string {
  return `${sessionId.slice(0, 8)}:${turn}`
}

export function project(cwd: string): string {
  const parts = cwd.split('/').filter((p) => p !== '')
  return parts.at(-1) ?? cwd
}

export function day(iso: string): string {
  return iso.slice(0, 10)
}

// ---------------------------------------------------------------------------------------------
// Tool calls

export const INPUT_LIMIT = 1000
export const OUTPUT_LIMIT = 2000

export function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

// Keys the engine adds beside the tool's own arguments.
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

export function toolInput(input: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (RESERVED.has(k)) continue
    const text = typeof v === 'string' ? v : JSON.stringify(v)
    if (text === undefined) continue
    out[k] = cut(text, INPUT_LIMIT)
  }
  return out
}

// What the tool.call chain resolved to, reduced to the fields the mod reads.
export type CallResult = { deny?: string; isError?: boolean; text?: string; result?: unknown; context?: readonly string[] }

export function outcomeOf(r: CallResult): Outcome {
  if (r.deny !== undefined) return 'denied'
  return r.isError === true ? 'error' : 'ok'
}

export function outputOf(r: CallResult): string {
  if (r.deny !== undefined) return cut(r.deny, OUTPUT_LIMIT)
  if (typeof r.text === 'string') return cut(r.text, OUTPUT_LIMIT)
  if (typeof r.result === 'string') return cut(r.result, OUTPUT_LIMIT)
  const json = r.result === undefined ? '' : JSON.stringify(r.result)
  return cut(json ?? '', OUTPUT_LIMIT)
}

export const LOOP_MARK = 'Loop check'

export function isNudged(r: CallResult): boolean {
  return (r.context ?? []).some((c) => c.includes(LOOP_MARK))
}

// Skills that reached the agent: the Skill tool's own argument, and the blocks the skill-loader mod
// appends, which start with `The skill <name>`.
export function skillsOf(tool: string, input: Readonly<Record<string, unknown>>, r: CallResult): string[] {
  const found: string[] = []
  if (tool === 'Skill') {
    const s: unknown = Reflect.get(input, 'skill')
    if (typeof s === 'string' && s !== '') found.push(s)
  }
  for (const c of r.context ?? []) {
    const name = /^The skill (\S+)/.exec(c)?.[1]
    if (name !== undefined) found.push(name)
  }
  return found
}

// ---------------------------------------------------------------------------------------------
// Prompts and implicit signals

// Origins that no person typed. Every other origin counts as the user's.
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

export function isHuman(origin: { kind: string } | undefined): boolean {
  return origin === undefined || !AUTOMATIC_ORIGINS.has(origin.kind)
}

// Lowercase, without accents and punctuation, single spaces.
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function words(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((w) => w !== ''))
}

export function jaccard(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (x.size === 0 && y.size === 0) return 0
  let both = 0
  for (const w of x) if (y.has(w)) both += 1
  return both / (x.size + y.size - both)
}

export const RETRY_SIMILARITY = 0.6

export function isRetry(previous: string, next: string): boolean {
  return jaccard(previous, next) >= RETRY_SIMILARITY
}

// Phrases that mean the last answer missed. Written without accents: the match ignores them.
export const CORRECTION_PHRASES = [
  'nao era isso',
  'nao e isso',
  'errado',
  'ta errado',
  'esta errado',
  'nao gostei',
  'refaz',
  'refazer',
  'de novo nao',
  'para de',
  'pare de',
  'nao e assim',
  'nao foi isso',
  'nao ficou bom',
  'nao funcionou',
  'continua errado',
  'voce errou',
  'wrong',
  'not what i asked',
  'thats not it',
  'that is not it',
  'try again',
  'doesnt work',
  'does not work',
]

// Phrases that mean the last answer landed.
export const APPROVAL_PHRASES = [
  'perfeito',
  'otimo',
  'isso mesmo',
  'valeu',
  'ficou bom',
  'excelente',
  'funcionou',
  'perfect',
  'great',
  'exactly',
  'thanks',
]

// A phrase matches as whole words, so `boa` does not match `boato`. Apostrophes vanish in
// normalize, so `that's` reads `that s`; the phrases drop them the same way.
// Words that are approval only in a short message: `boa!` or `show` alone, but not `boa tarde, me
// manda o relatório` or `show me the file`.
export const SHORT_APPROVAL_WORDS = ['boa', 'show', 'top', 'massa']
const SHORT_MESSAGE_WORDS = 3

export function approves(text: string): boolean {
  if (mentions(text, APPROVAL_PHRASES)) return true
  const words = normalize(text.replace(/['’]/g, '')).split(' ').filter((w) => w !== '')
  return words.length <= SHORT_MESSAGE_WORDS && mentions(text, SHORT_APPROVAL_WORDS)
}

export function mentions(text: string, phrases: readonly string[]): boolean {
  const t = ` ${normalize(text.replace(/['’]/g, ''))} `
  return phrases.some((p) => t.includes(` ${normalize(p)} `))
}

export type NextPrompt = { text: string; human: boolean } | null

export type TurnCounts = { aborted: boolean; loopNudges: number; toolErrors: number; refusals: number }

// The signals of a finished turn, from what it did and the prompt that came after it. A correction
// wins over an approval, because `não ficou bom` also contains `ficou bom`.
export function signalsFor(counts: TurnCounts, previousPrompt: string, next: NextPrompt): Signals {
  const human = next !== null && next.human
  const correction = human && mentions(next.text, CORRECTION_PHRASES)
  return {
    aborted: counts.aborted,
    retried: human && isRetry(previousPrompt, next.text),
    correction,
    approval: human && !correction && approves(next.text),
    loopNudges: counts.loopNudges,
    toolErrors: counts.toolErrors,
    refusals: counts.refusals,
  }
}

export function implicitScore(s: Signals): number {
  let score = 3
  if (s.approval) score += 1.5
  if (s.correction) score -= 1.5
  if (s.retried) score -= 1
  if (s.aborted) score -= 2
  score -= Math.min(1, 0.5 * s.loopNudges)
  score -= Math.min(1, 0.25 * s.refusals)
  return Math.round(Math.min(5, Math.max(1, score)) * 10) / 10
}

// ---------------------------------------------------------------------------------------------
// /rate

export type RateRequest = { kind: 'show' } | { kind: 'rate'; score: number; tags: string[]; comment?: string } | { kind: 'invalid' }

export const RATE_USAGE = 'Usage: /rate <1-5> [tags...] [-- comment]. Example: /rate 2 verbose wrong-file -- read the whole repo for a one-line fix'

export function parseRate(args: string): RateRequest {
  const text = args.trim()
  if (text === '') return { kind: 'show' }
  const split = text.indexOf('--')
  const head = (split === -1 ? text : text.slice(0, split)).trim()
  const comment = split === -1 ? '' : text.slice(split + 2).trim()
  const [first, ...tags] = head.split(/\s+/).filter((w) => w !== '')
  if (first === undefined || !/^[1-5]$/.test(first)) return { kind: 'invalid' }
  return { kind: 'rate', score: Number(first), tags, ...(comment === '' ? {} : { comment }) }
}

export function excerpt(text: string, limit = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export function rateText(id: string, score: number, prompt: string): string {
  return `Rated ${score}/5: ${id} "${excerpt(prompt)}"`
}

export function showText(id: string, prompt: string, user: number | null, implicit: number | null): string {
  const u = user === null ? 'not rated' : `${user}/5`
  const i = implicit === null ? 'pending until your next prompt' : `${implicit}`
  return `Last turn: ${id} "${excerpt(prompt)}"\nYou: ${u} · implicit: ${i}\n${RATE_USAGE}`
}

// ---------------------------------------------------------------------------------------------
// Reading the dataset

function obj(v: unknown): v is object {
  return typeof v === 'object' && v !== null
}

export function isTurn(v: unknown): v is TurnRecord {
  return obj(v) && typeof Reflect.get(v, 'id') === 'string' && typeof Reflect.get(v, 'prompt') === 'string' && Array.isArray(Reflect.get(v, 'tools'))
}

export function isRating(v: unknown): v is RatingRecord {
  return obj(v) && typeof Reflect.get(v, 'turn') === 'string' && typeof Reflect.get(v, 'score') === 'number' && Reflect.get(v, 'source') === 'user'
}

export function isSignal(v: unknown): v is SignalRecord {
  return obj(v) && typeof Reflect.get(v, 'turn') === 'string' && typeof Reflect.get(v, 'implicitScore') === 'number' && obj(Reflect.get(v, 'signals'))
}

export function parseLines<T>(text: string, guard: (v: unknown) => v is T): T[] {
  const out: T[] = []
  for (const l of text.split('\n')) {
    if (l.trim() === '') continue
    try {
      const v: unknown = JSON.parse(l)
      if (guard(v)) out.push(v)
    } catch {
      // a line cut by a crash mid-write
    }
  }
  return out
}

// Day files from `days` days ago up to today, by the date in their name.
export function inWindow(name: string, today: string, days: number): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)
  if (m?.[1] === undefined) return false
  const from = Date.parse(today) - (Math.max(1, days) - 1) * 86_400_000
  return Date.parse(m[1]) >= from
}

export function parseDays(args: string): number {
  const n = Number(args.trim())
  return Number.isInteger(n) && n > 0 ? n : 7
}

// The last line for each turn wins.
export function latest<T extends { turn: string }>(rows: readonly T[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const r of rows) m.set(r.turn, r)
  return m
}

// ---------------------------------------------------------------------------------------------
// /ratings

type Bucket = { turns: number; user: number[]; implicit: number[] }

function bucket(): Bucket {
  return { turns: 0, user: [], implicit: [] }
}

function avg(xs: readonly number[]): string {
  if (xs.length === 0) return 'none'
  return (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// `2026-10-01` → `Oct 1`, the date format the other mods use.
export function shortDate(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

// One line of the report with its tone: the text reply joins them, the pane colors them.
export type ReportLine = { text: string; tone: 'title' | 'heading' | 'plain' | 'dim' }

// The user's part reads "not rated yet" instead of a "none (0 rated)" that repeats on every line.
function yours(scores: readonly number[]): string {
  return scores.length === 0 ? 'not rated yet' : `you ${avg(scores)} over ${plural(scores.length, 'rating')}`
}

function bucketText(name: string, b: Bucket): string {
  const implicit = b.implicit.length === 0 ? '' : `, implicit ${avg(b.implicit)}`
  return `  ${name}: ${plural(b.turns, 'turn')}, ${yours(b.user)}${implicit}`
}

function section(title: string, rows: ReadonlyMap<string, Bucket>): ReportLine[] {
  if (rows.size === 0) return []
  const sorted = [...rows.entries()].sort((a, b) => b[1].turns - a[1].turns || a[0].localeCompare(b[0]))
  return [{ text: title, tone: 'heading' }, ...sorted.map(([name, b]): ReportLine => ({ text: bucketText(name, b), tone: 'plain' }))]
}

function compare(label: string, withIt: readonly number[], without: readonly number[]): ReportLine | null {
  // With no rating on either side there is nothing to compare yet.
  if (withIt.length === 0 && without.length === 0) return null
  return { text: `  ${label}: you ${avg(withIt)} with (${plural(withIt.length, 'turn')}), ${avg(without)} without (${plural(without.length, 'turn')})`, tone: 'plain' }
}

// The effect of signals needs ratings from the user; the section shows once there is one to compare.
function signalsSection(lines: ReadonlyArray<ReportLine | null>): ReportLine[] {
  const shown = lines.filter((l): l is ReportLine => l !== null)
  return shown.length === 0 ? [] : [{ text: 'Effect of signals', tone: 'heading' }, ...shown]
}

function span(today: string, days: number): string {
  if (days === 1) return `today (${shortDate(today)})`
  const from = new Date(Date.parse(today) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  return `last ${days} days (${shortDate(from)} to ${shortDate(today)})`
}

// The /ratings report: plain lines without column padding, so it reads the same in Remote Control.
export function report(turns: readonly TurnRecord[], ratings: readonly RatingRecord[], signals: readonly SignalRecord[], days: number, today: string): ReportLine[] {
  const title: ReportLine = { text: `Ratings, ${span(today, days)}`, tone: 'title' }
  if (turns.length === 0) return [title, { text: 'No turns recorded in this window.', tone: 'dim' }]
  const user = latest(ratings)
  const implicit = latest(signals)
  const total = bucket()
  const byProject = new Map<string, Bucket>()
  const bySkill = new Map<string, Bucket>()
  const nudge = { with: [] as number[], without: [] as number[] }
  const refusal = { with: [] as number[], without: [] as number[] }
  const rated: Array<{ t: TurnRecord; score: number }> = []
  for (const t of turns) {
    const u = user.get(t.id)?.score
    const s = implicit.get(t.id)
    const add = (b: Bucket) => {
      b.turns += 1
      if (u !== undefined) b.user.push(u)
      if (s !== undefined) b.implicit.push(s.implicitScore)
    }
    add(total)
    const p = byProject.get(t.project) ?? bucket()
    byProject.set(t.project, p)
    add(p)
    for (const name of new Set(t.skills)) {
      const b = bySkill.get(name) ?? bucket()
      bySkill.set(name, b)
      add(b)
    }
    if (u !== undefined) {
      rated.push({ t, score: u })
      const nudged = s !== undefined ? s.signals.loopNudges > 0 : t.tools.some((x) => x.nudged === true)
      const refused = s !== undefined ? s.signals.refusals > 0 : t.tools.some((x) => x.outcome === 'denied')
      ;(nudged ? nudge.with : nudge.without).push(u)
      ;(refused ? refusal.with : refusal.without).push(u)
    }
  }
  const lowest = [...rated].sort((a, b) => a.score - b.score || b.t.at.localeCompare(a.t.at)).slice(0, 5)
  return [
    title,
    { text: `${plural(total.turns, 'turn')} recorded, ${total.user.length} rated by you (${pct(total.user.length, total.turns)})`, tone: 'plain' },
    { text: `Average: ${total.user.length === 0 ? 'not rated by you yet' : `you ${avg(total.user)}`}, implicit ${avg(total.implicit)} (${total.implicit.length} with signals)`, tone: 'plain' },
    ...section('Per project', byProject),
    ...section('Per skill used', bySkill),
    ...signalsSection([compare('loop nudges', nudge.with, nudge.without), compare('refusals', refusal.with, refusal.without)]),
    { text: 'Lowest rated', tone: 'heading' },
    ...(lowest.length === 0
      ? [{ text: '  none rated yet', tone: 'dim' } satisfies ReportLine]
      : lowest.map((r): ReportLine => ({ text: `  ${r.score}/5 ${r.t.id} "${excerpt(r.t.prompt)}"`, tone: 'plain' }))),
  ]
}

// ---------------------------------------------------------------------------------------------
// The band

export const BAND_LABELS = ['bad', 'weak', 'ok', 'good', 'great'] as const

// What the rating row holds at a width. The five buttons (`1: bad` to `5: great`) take 33 columns; the
// label and the hint come and go so the row never wraps, down to 50 columns.
export type BandLayout = { label: string; gap: number; hint: string | null }

export function bandLayout(columns: number): BandLayout {
  if (columns >= 90) return { label: 'Rate the last answer:', gap: 2, hint: '/rate N tags -- comment' }
  if (columns >= 66) return { label: 'Rate the last answer:', gap: 2, hint: null }
  return { label: 'Rate:', gap: 1, hint: null }
}
