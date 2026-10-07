// The audit mod's rules, with no mods API, so the tests run them directly.

export type Options = {
  // How many days of audit files to keep.
  retentionDays: number
  // How many entries /audit shows when no number is given.
  showCount: number
  // Time zone of the times /audit shows.
  timeZone: string
}

export const DEFAULTS: Options = { retentionDays: 30, showCount: 20, timeZone: 'America/Sao_Paulo' }

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const num = (key: string, fallback: number): number => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const tz: unknown = Reflect.get(values, 'timeZone')
  return {
    retentionDays: num('retentionDays', DEFAULTS.retentionDays),
    showCount: num('showCount', DEFAULTS.showCount),
    timeZone: typeof tz === 'string' && tz !== '' ? tz : DEFAULTS.timeZone,
  }
}

export type McpTool = { server: string; action: string }

// `mcp__claude_ai_Slack__slack_send_message` → server `claude_ai_Slack`, action `slack_send_message`.
export function mcpTool(tool: string): McpTool | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (m?.[1] === undefined || m[2] === undefined) return null
  return { server: m[1], action: m[2] }
}

// An action whose name starts with one of these words only reads. Anything else counts as a write,
// because a missing line costs more than an extra one.
const READ_WORDS = [
  'get', 'list', 'search', 'read', 'query', 'describe', 'preview', 'fetch', 'find', 'discover',
  'ask', 'resolve', 'show', 'inspect', 'check', 'view', 'download', 'suggest', 'browser_snapshot',
  'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests',
]

export function isWrite(action: string): boolean {
  // Some servers prefix every action with their own name, as in `slack_read_channel` or `notion-fetch`.
  const words = action.toLowerCase().split(/[_-]/)
  const candidates = [action.toLowerCase(), words.slice(1).join('_'), words.slice(1).join('-')]
  return !READ_WORDS.some((w) => candidates.some((c) => c.startsWith(w)))
}

const FIELD_LIMIT = 300
// One line stays under the 4 KiB that the kernel appends in one piece.
const LINE_LIMIT = 3500

// The call's arguments, each cut to a readable length, without the fields the mod adds itself.
export function summarize(input: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (k === 'tool' || k === 'tool_use_id' || k === 'agentId' || k === 'consent') continue
    const text = typeof v === 'string' ? v : JSON.stringify(v)
    if (text === undefined) continue
    out[k] = text.length > FIELD_LIMIT ? `${text.slice(0, FIELD_LIMIT)}…` : text
  }
  return out
}

export type Entry = {
  at: string
  session: string
  cwd: string
  agentId?: string
  server: string
  action: string
  input: Record<string, string>
  outcome: 'ok' | 'error' | 'denied'
  error?: string
  ms: number
}

export function line(entry: Entry): string {
  const full = JSON.stringify(entry)
  if (full.length <= LINE_LIMIT) return full
  // Too long: keep only the start of each argument.
  const input = Object.fromEntries(Object.entries(entry.input).map(([k, v]) => [k, v.slice(0, 60)]))
  return JSON.stringify({ ...entry, input, error: entry.error?.slice(0, 200) }).slice(0, LINE_LIMIT)
}

export function fileName(isoDay: string): string {
  return `${isoDay}.jsonl`
}

// The audit files older than the retention, by the date in their name.
export function expired(names: readonly string[], todayIso: string, retentionDays: number): string[] {
  const limit = Date.parse(todayIso) - retentionDays * 86_400_000
  return names.filter((n) => {
    const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(n)
    return m?.[1] !== undefined && Date.parse(m[1]) < limit
  })
}

function isEntry(v: unknown): v is Entry {
  if (typeof v !== 'object' || v === null) return false
  return typeof Reflect.get(v, 'at') === 'string' && typeof Reflect.get(v, 'action') === 'string'
}

export function parse(text: string): Entry[] {
  const entries: Entry[] = []
  for (const l of text.split('\n')) {
    if (l.trim() === '') continue
    try {
      const v: unknown = JSON.parse(l)
      if (isEntry(v)) entries.push(v)
    } catch {
      // a cut line from a crash mid-write
    }
  }
  return entries
}

export function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

// `/audit 50 slack` → the last 50 entries whose server or action mentions `slack`.
export function request(args: string, o: Options): { count: number; filter: string } {
  let count = o.showCount
  const words: string[] = []
  for (const w of args.trim().split(/\s+/)) {
    if (w === '') continue
    if (/^\d+$/.test(w)) count = Number(w)
    else words.push(w.toLowerCase())
  }
  return { count, filter: words.join(' ') }
}

// The entries whose server or action mentions the filter, all of them when the filter is empty.
export function matching(entries: readonly Entry[], filter: string): Entry[] {
  return filter === '' ? [...entries] : entries.filter((e) => `${e.server} ${e.action}`.toLowerCase().includes(filter))
}

export function emptyText(filter: string): string {
  return filter === '' ? 'No write calls recorded in the audit window.' : `No write calls match "${filter}".`
}

// The arguments as `key=value`, each value cut at 80 characters.
export function argsText(input: Readonly<Record<string, string>>): string {
  return Object.entries(input).map(([k, v]) => `${k}=${v.length > 80 ? v.slice(0, 80) + '…' : v}`).join(', ')
}

// Cuts a text to fit `width` columns, marking the cut with `…`.
export function cut(text: string, width: number): string {
  if (text.length <= width) return text
  return width <= 1 ? '…' : `${text.slice(0, width - 1)}…`
}

export function report(entries: readonly Entry[], args: string, o: Options): string {
  const { count, filter } = request(args, o)
  const last = matching(entries, filter).slice(-count)
  if (last.length === 0) return emptyText(filter)
  const lines = last.map((e) => {
    const args = argsText(e.input)
    const status = e.outcome === 'ok' ? 'ok' : `${e.outcome}${e.error === undefined ? '' : ': ' + e.error.slice(0, 120)}`
    const who = e.agentId === undefined ? '' : ' (subagent)'
    return `${formatTime(e.at, o.timeZone)} · ${e.server} · ${e.action}${who} · ${status}\n    ${args}`
  })
  return [`Last ${last.length} write call(s)${filter === '' ? '' : ` matching "${filter}"`}:`, ...lines].join('\n')
}
