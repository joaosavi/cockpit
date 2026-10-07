// The mod-report mod's rules, with no mods API, so the tests run them directly: which diary files fall
// in the window, what their lines say, and the report `/mods` writes from them.

export const DEFAULT_DAYS = 7
export const MAX_DAYS = 365
// Above this average overhead per tool call, a mod is flagged as getting in the way.
export const SLOW_MS = 20

// The mods in the order the report lists them. A folder of another mod comes after, by name.
const ORDER = ['usage-limit', 'memory-guard', 'skill-loader', 'audit', 'loop-breaker', 'secret-guard', 'pipefail']

// `/mods 30` → 30 days. Anything else → the default.
export function parseDays(args: string): number {
  const m = /^\s*(\d+)\s*$/.exec(args)
  if (m?.[1] === undefined) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.max(1, Number(m[1])))
}

// The day in a diary's name: `2026-10-07-abcdef12.jsonl` for a session's diary, `2026-10-07.jsonl` for audit's day file.
export function fileDay(name: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:-[\w-]+)?\.jsonl$/.exec(name)
  return m?.[1] ?? null
}

// The first day of a window of `days` days that ends today, as `YYYY-MM-DD`.
export function firstDay(today: string, days: number): string {
  return new Date(Date.parse(today) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
}

export function inWindow(name: string, today: string, days: number): boolean {
  const day = fileDay(name)
  return day !== null && day >= firstDay(today, days) && day <= today
}

export type DiaryFile = { mod: string; name: string; text: string }

type Summary = {
  session: string
  toolCalls: number
  actions: Record<string, number>
  hookMs: number
  maxHookMs: number
  waitedMs: number
}

type AuditCall = { server: string; outcome: string }

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function asSummary(v: unknown): Summary | null {
  if (typeof v !== 'object' || v === null || Reflect.get(v, 'event') !== 'session-summary') return null
  const session: unknown = Reflect.get(v, 'session')
  const raw: unknown = Reflect.get(v, 'actions')
  const actions: Record<string, number> = {}
  if (typeof raw === 'object' && raw !== null) for (const [k, n] of Object.entries(raw)) actions[k] = num(n)
  return {
    session: typeof session === 'string' ? session : '',
    toolCalls: num(Reflect.get(v, 'toolCalls')),
    actions,
    hookMs: num(Reflect.get(v, 'hookMs')),
    maxHookMs: num(Reflect.get(v, 'maxHookMs')),
    waitedMs: num(Reflect.get(v, 'waitedMs')),
  }
}

// One of audit's per-call lines: it names the server and the action.
function asAuditCall(v: unknown): AuditCall | null {
  if (typeof v !== 'object' || v === null) return null
  const server: unknown = Reflect.get(v, 'server')
  const action: unknown = Reflect.get(v, 'action')
  const outcome: unknown = Reflect.get(v, 'outcome')
  if (typeof server !== 'string' || typeof action !== 'string') return null
  return { server, outcome: typeof outcome === 'string' ? outcome : 'ok' }
}

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

export type ModStats = {
  mod: string
  sessions: number
  // Session diaries in the window without a summary line: sessions still open, or from before the summaries.
  openDiaries: number
  toolCalls: number
  actions: Record<string, number>
  hookMs: number
  maxHookMs: number
  waitedMs: number
  // audit only: write calls by server, and the ones that failed or were denied.
  writes: Record<string, number>
  failedWrites: number
}

function empty(mod: string): ModStats {
  return { mod, sessions: 0, openDiaries: 0, toolCalls: 0, actions: {}, hookMs: 0, maxHookMs: 0, waitedMs: 0, writes: {}, failedWrites: 0 }
}

export function aggregate(files: readonly DiaryFile[]): ModStats[] {
  const byMod = new Map<string, ModStats>()
  const seen = new Map<string, Set<string>>()
  for (const f of files) {
    const s = byMod.get(f.mod) ?? empty(f.mod)
    byMod.set(f.mod, s)
    const sessions = seen.get(f.mod) ?? new Set<string>()
    seen.set(f.mod, sessions)
    let summarized = false
    for (const r of records(f.text)) {
      const sum = asSummary(r)
      if (sum !== null) {
        summarized = true
        sessions.add(sum.session === '' ? `${f.name}#${sessions.size}` : sum.session)
        s.toolCalls += sum.toolCalls
        s.hookMs += sum.hookMs
        s.maxHookMs = Math.max(s.maxHookMs, sum.maxHookMs)
        s.waitedMs += sum.waitedMs
        for (const [k, n] of Object.entries(sum.actions)) s.actions[k] = (s.actions[k] ?? 0) + n
        continue
      }
      const call = asAuditCall(r)
      if (call !== null) {
        s.writes[call.server] = (s.writes[call.server] ?? 0) + 1
        if (call.outcome !== 'ok') s.failedWrites += 1
      }
    }
    // A day file of audit holds every session's lines, so only a session's own diary can lack its summary.
    if (!summarized && /^\d{4}-\d{2}-\d{2}-[\w-]+\.jsonl$/.test(f.name)) s.openDiaries += 1
  }
  for (const [mod, s] of byMod) s.sessions = seen.get(mod)?.size ?? 0
  const rank = (m: string) => (ORDER.includes(m) ? ORDER.indexOf(m) : ORDER.length)
  return [...byMod.values()].sort((a, b) => rank(a.mod) - rank(b.mod) || a.mod.localeCompare(b.mod))
}

export function perCall(s: ModStats): number | null {
  return s.toolCalls === 0 ? null : s.hookMs / s.toolCalls
}

function ms(n: number): string {
  return n >= 10 ? `${Math.round(n)} ms` : `${Math.round(n * 10) / 10} ms`
}

export function duration(msTotal: number): string {
  const s = Math.round(msTotal / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return s % 60 === 0 ? `${m}m` : `${m}m ${s % 60}s`
}

function count(s: ModStats, action: string): number {
  return s.actions[action] ?? 0
}

// `loaded:a 3, loaded:b 1, refused 2` → `loaded: a 3, b 1 · refused 2`, biggest first within a group.
export function actionsText(actions: Readonly<Record<string, number>>, skip: readonly string[] = []): string {
  const plain: Array<[string, number]> = []
  const groups = new Map<string, Array<[string, number]>>()
  for (const [k, n] of Object.entries(actions)) {
    if (n === 0 || skip.includes(k)) continue
    const i = k.indexOf(':')
    if (i < 0) plain.push([k, n])
    else {
      const g = groups.get(k.slice(0, i)) ?? []
      g.push([k.slice(i + 1), n])
      groups.set(k.slice(0, i), g)
    }
  }
  const parts = [
    ...[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([g, items]) => `${g}: ${items.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(', ')}`),
    ...plain.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`),
  ]
  return parts.join(' · ')
}

function total(actions: Readonly<Record<string, number>>, prefix: string): number {
  return Object.entries(actions).reduce((sum, [k, n]) => (k.startsWith(prefix) ? sum + n : sum), 0)
}

// The second row of a mod: what it did, with the figures its own question needs first.
function detail(s: ModStats): string {
  switch (s.mod) {
    case 'usage-limit': {
      const rest = actionsText(s.actions, ['paused', 'resumed'])
      return [`pauses ${count(s, 'paused')} · resumes ${count(s, 'resumed')}`, rest].filter((p) => p !== '').join(' · ')
    }
    case 'memory-guard': {
      const held = `held ${duration(s.waitedMs)} over ${count(s, 'waited')} command(s) · refused ${count(s, 'refused')}`
      return [held, actionsText(s.actions, ['waited', 'refused'])].filter((p) => p !== '').join(' · ')
    }
    case 'audit': {
      const servers = Object.entries(s.writes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      const writes = servers.length === 0 ? 'no write calls' : `writes: ${servers.map(([k, n]) => `${k} ${n}`).join(', ')}`
      return s.failedWrites === 0 ? writes : `${writes} · ${s.failedWrites} failed or denied`
    }
    default:
      return actionsText(s.actions) || 'no actions'
  }
}

export type ReportLine = { text: string; tone: 'title' | 'plain' | 'dim' | 'warn' }

// The things that say a mod is getting in the way, or did something worth a look.
export function attention(stats: readonly ModStats[]): string[] {
  const out: string[] = []
  for (const s of stats) {
    const avg = perCall(s)
    if (avg !== null && avg > SLOW_MS) out.push(`${s.mod} adds ${ms(avg)} per tool call, above ${SLOW_MS} ms`)
  }
  const get = (mod: string) => stats.find((s) => s.mod === mod)
  const memory = get('memory-guard')
  if (memory !== undefined && count(memory, 'refused') > 0) out.push(`memory-guard refused ${count(memory, 'refused')} command(s), after holding them ${duration(memory.waitedMs)} in all`)
  const skills = get('skill-loader')
  if (skills !== undefined && count(skills, 'refused') > 0) out.push(`skill-loader refused ${count(skills, 'refused')} write(s) to deliver a skill, and the agent had to redo them`)
  const loops = get('loop-breaker')
  const nudges = loops === undefined ? 0 : total(loops.actions, 'nudge')
  if (loops !== undefined && nudges > 0) out.push(`loop-breaker nudged ${nudges} time(s): ${actionsText(loops.actions).replace(/^nudge: /, '')}`)
  const usage = get('usage-limit')
  if (usage !== undefined && count(usage, 'paused') > 0) out.push(`usage-limit paused ${count(usage, 'paused')} time(s), resumed ${count(usage, 'resumed')}`)
  return out
}

export function render(stats: readonly ModStats[], today: string, days: number): ReportLine[] {
  const lines: ReportLine[] = [{ text: `Mods, last ${days} day(s): ${firstDay(today, days)} to ${today}`, tone: 'title' }]
  if (stats.length === 0) return [...lines, { text: 'No mod diaries in this window.', tone: 'dim' }]
  for (const s of stats) {
    const open = s.openDiaries === 0 ? '' : ` (+${s.openDiaries} open or without summary)`
    if (s.sessions === 0 && s.mod !== 'audit') {
      lines.push({ text: `${s.mod} · no session summary yet${open}`, tone: 'plain' })
      continue
    }
    const avg = perCall(s)
    const cost = avg === null ? '' : ` · ${ms(avg)}/call, max ${ms(s.maxHookMs)}`
    lines.push({ text: `${s.mod} · ${s.sessions} session(s)${open} · ${s.toolCalls} tool call(s)${cost}`, tone: 'plain' })
    lines.push({ text: `  ${detail(s)}`, tone: 'dim' })
  }
  const flags = attention(stats)
  lines.push({ text: 'Attention', tone: 'title' })
  if (flags.length === 0) lines.push({ text: '  nothing to flag', tone: 'dim' })
  for (const f of flags) lines.push({ text: `  ${f}`, tone: 'warn' })
  return lines
}
