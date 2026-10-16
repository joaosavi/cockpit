// The four layouts of the status line under the prompt: refined (the default), blocks, minimal and
// compact. Each builds its rows from the richest variant to the barest and keeps the first that fits
// the columns, so a narrow terminal loses the least useful fields first and no row passes the width.

import {
  type BarColor,
  heat,
  age,
  bytes,
  contextTone,
  type Git,
  type IconSet,
  limitTone,
  memoryTone,
  type Pr,
  resetIn,
  type Row,
  type Seg,
  type Snapshot,
  spread,
  type StatusStyle,
  type Tone,
  visible,
  width,
  windowOf,
} from './rules.ts'

// --- icons ---

export type Icons = {
  model: string
  folder: string
  branch: string
  ahead: string
  behind: string
  staged: string
  modified: string
  untracked: string
  synced: string
  pr: string
  ok: string
  fail: string
  pending: string
  clock: string
  mem: string
}

// Nerd Font glyphs (Octicons and Material Design), one cell wide in a Nerd Font Mono.
const NERD: Icons = {
  model: '\u{F06A9}',
  folder: '\u{F413}',
  branch: '\u{F418}',
  ahead: '\u{F431}',
  behind: '\u{F433}',
  staged: '\u{F44D}',
  modified: '\u{F459}',
  untracked: '\u{F420}',
  synced: '\u{F46A}',
  pr: '\u{F407}',
  ok: '\u{F42E}',
  fail: '\u{F467}',
  pending: '\u{F4C3}',
  clock: '\u{F43A}',
  mem: '\u{F035B}',
}

// Plain Unicode for a terminal without a Nerd Font. An empty icon is left out with its space.
const UNICODE: Icons = {
  model: '',
  folder: '',
  branch: '',
  ahead: '↑',
  behind: '↓',
  staged: '+',
  modified: '●',
  untracked: '?',
  synced: '✓',
  pr: 'PR',
  ok: '✓',
  fail: '✗',
  pending: '…',
  clock: '',
  mem: '',
}

export function iconsOf(set: IconSet): Icons {
  return set === 'unicode' ? UNICODE : NERD
}

// An icon and its text with one space between, or the text alone when the icon is empty.
function lead(icon: string, text: string): string {
  return icon === '' ? text : `${icon} ${text}`
}

// --- the pieces every style shares ---

const CHECK_TONE: Record<Exclude<Pr['checks'], 'none'>, Tone> = { ok: 'success', fail: 'error', pending: 'warning' }

function checkSeg(pr: Pr, ic: Icons): Seg[] {
  if (pr.checks === 'none') return []
  const glyph = pr.checks === 'ok' ? ic.ok : pr.checks === 'fail' ? ic.fail : ic.pending
  return [{ text: ' ' }, { text: glyph, tone: CHECK_TONE[pr.checks] }]
}

// The git counts as icon and number: `↑ 2  + 1  ● 3`, or `✓ synced` when there is nothing.
function countSegs(g: Git, ic: Icons): Seg[][] {
  const out: Seg[][] = []
  const add = (n: number | undefined, icon: string, seg: Omit<Seg, 'text'>) => {
    if (n !== undefined && n > 0) out.push([{ text: lead(icon, String(n)), ...seg }])
  }
  add(g.ahead, ic.ahead, { hue: 'ahead' })
  add(g.behind, ic.behind, { hue: 'behind' })
  add(g.staged, ic.staged, { tone: 'success' })
  add(g.modified, ic.modified, { tone: 'warning' })
  add(g.untracked, ic.untracked, { dim: true })
  if (out.length === 0) out.push([{ text: lead(ic.synced, 'synced'), tone: 'success' }])
  return out
}

// The same counts in words, for the minimal style: `2 to push · 1 staged · 3 modified`.
function countWords(g: Git): Seg[][] {
  const out: Seg[][] = []
  const add = (n: number | undefined, word: string, seg: Omit<Seg, 'text'>) => {
    if (n !== undefined && n > 0) out.push([{ text: `${n} ${word}`, ...seg }])
  }
  add(g.ahead, 'to push', { hue: 'ahead' })
  add(g.behind, 'to pull', { hue: 'behind' })
  add(g.staged, 'staged', { tone: 'success' })
  add(g.modified, 'modified', { tone: 'warning' })
  add(g.untracked, 'untracked', { dim: true })
  if (out.length === 0) out.push([{ text: 'in sync', tone: 'success' }])
  return out
}

function join(parts: readonly Seg[][], sep: Seg): Seg[] {
  return parts.flatMap((p, i) => (i === 0 ? p : [sep, ...p]))
}

// The bar's colors, set once per render by statusRows from the barColor option.
let barColor: BarColor = 'gradient'

function bar(percent: number, cells: number, tone: Tone, on: string, off: string): Seg[] {
  const k = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  const segs: Seg[] = []
  if (barColor === 'gradient') for (let i = 0; i < k; i++) segs.push({ text: on, rgb: heat(cells === 1 ? 1 : i / (cells - 1)) })
  else if (k > 0) segs.push({ text: on.repeat(k), ...(barColor === 'solid' ? { rgb: heat(percent / 100) } : { tone }) })
  if (cells - k > 0) segs.push({ text: off.repeat(cells - k), dim: true })
  return segs
}

// A percent's color: the heat of its value, or the threshold tone with barColor `tone`.
function level(percent: number, tone: Tone): Omit<Seg, 'text'> {
  return barColor === 'tone' ? { tone } : { rgb: heat(percent / 100) }
}

const pct = (p: number): string => `${Math.round(p)}%`

type Meters = { ctx: number | null; five: { p: number; reset: string | null } | null; seven: number | null; mem: number | null }

function meters(s: Snapshot): Meters {
  const five = windowOf(s, 'five_hour')
  const seven = windowOf(s, 'seven_day')
  return {
    ctx: s.context,
    five: five === null ? null : { p: five.percentUsed, reset: five.resetsAt === undefined ? null : resetIn(five.resetsAt, s.now) },
    seven: seven?.percentUsed ?? null,
    mem: s.memory?.headroom ?? null,
  }
}

// The first candidate whose rows all fit; the last one when none does.
function fit(candidates: readonly Row[][], columns: number): Row[] {
  for (const c of candidates) if (c.every((r) => width(r) <= columns)) return c
  return candidates.at(-1) ?? []
}

// Left and right on one row with the right flush to the last column, or the left alone.
function edge(left: Row, right: Row, columns: number): Row {
  if (right.length === 0) return left
  return spread(left, right, columns) ?? left
}

function sessionRight(s: Snapshot, ic: Icons, withCalls: boolean, withTime: boolean): Row {
  const out: Row = []
  if (withTime && s.startedAt !== null) out.push({ text: lead(ic.clock, age(s.now - s.startedAt)), dim: true })
  if (withCalls && !(s.style?.hide.has('calls') ?? false)) {
    if (out.length > 0) out.push({ text: '  ·  ', dim: true })
    out.push({ text: `${s.calls} ${s.calls === 1 ? 'call' : 'calls'}`, dim: true })
  }
  return out
}

// --- A: refined ---

function refined(s: Snapshot, ic: Icons, columns: number): Row[] {
  const m = meters(s)
  const top = (gapN: number, withPr: boolean, withTime: boolean, withCalls: boolean): Row => {
    const g = ' '.repeat(gapN)
    const left: Row = []
    if (s.model !== null) left.push(...(ic.model === '' ? [] : [{ text: `${ic.model} ` }]), { text: s.model, bold: true })
    // Claude Code draws uncolored status line text in gray, so the names that should stand out are bold.
    if (s.project !== null) left.push(...(left.length > 0 ? [{ text: g }] : []), { text: lead(ic.folder, s.project), bold: true })
    if (s.git !== null) {
      left.push({ text: g }, { text: lead(ic.branch, s.git.branch), hue: 'branch' }, { text: '  ' }, ...join(countSegs(s.git, ic), { text: '  ' }))
      if (withPr && s.pr) left.push({ text: g }, { text: lead(ic.pr, `#${s.pr.number}`), hue: 'pr' }, ...checkSeg(s.pr, ic))
    }
    return edge(left, sessionRight(s, ic, withCalls, withTime), columns)
  }
  const bottom = (cells: number, free: boolean, word: boolean): Row => {
    const on = s.style?.on ?? '●'
    const off = s.style?.off ?? '○'
    const groups: Row[] = []
    if (m.ctx !== null) groups.push([{ text: 'ctx ', dim: true }, ...bar(m.ctx, cells, contextTone(m.ctx), on, off), { text: ` ${pct(m.ctx)}`, ...level(m.ctx, contextTone(m.ctx)) }])
    if (m.five !== null) {
      const t = limitTone(m.five.p)
      groups.push([{ text: '5h ', dim: true }, ...bar(m.five.p, cells, t, on, off), { text: ` ${pct(m.five.p)}`, ...level(m.five.p, t) }, ...(m.five.reset === null ? [] : [{ text: `${word ? '  resets ' : ' '}${m.five.reset}`, dim: true }])])
    }
    if (m.seven !== null) groups.push([{ text: '7d ', dim: true }, ...bar(m.seven, cells, limitTone(m.seven), on, off), { text: ` ${pct(m.seven)}`, ...level(m.seven, limitTone(m.seven)) }])
    if (m.mem !== null) groups.push([...(ic.mem === '' ? [{ text: 'mem ', dim: true }] : [{ text: `${ic.mem} `, dim: true }]), { text: bytes(m.mem), tone: memoryTone(m.mem) }, ...(free ? [{ text: ' free', dim: true }] : [])])
    return join(groups, { text: '   ' })
  }
  const width0 = s.style?.barWidth ?? 10
  const tops = [top(3, true, true, true), top(3, true, true, false), top(2, true, true, false), top(2, true, false, false), top(2, false, false, false)]
  const bottoms = [bottom(width0, true, true), bottom(Math.min(width0, 8), true, true), bottom(Math.min(width0, 8), false, true), bottom(Math.min(width0, 8), false, false), bottom(6, false, false), bottom(4, false, false)]
  return [fitOne(tops, columns), fitOne(bottoms, columns)].filter((r) => r.length > 0)
}

function fitOne(rows: readonly Row[], columns: number): Row {
  return fit(rows.map((r) => [r]), columns)[0] ?? []
}

// --- B: blocks ---

function chip(text: string, seg: Omit<Seg, 'text'> = {}, strong = false): Seg {
  return { text: ` ${text} `, chip: strong ? 'strong' : 'soft', ...seg }
}

function blocks(s: Snapshot, ic: Icons, columns: number): Row[] {
  const m = meters(s)
  const top = (withPr: boolean, withTime: boolean): Row => {
    const left: Row = []
    if (s.model !== null) left.push(chip(lead(ic.model, s.model), { bold: true }, true))
    if (s.project !== null) left.push(...(left.length > 0 ? [{ text: ' ' }] : []), chip(lead(ic.folder, s.project)))
    if (s.git !== null) {
      const counts = countSegs(s.git, ic).map((p) => p.map((x) => x.text).join(''))
      left.push({ text: ' ' }, chip(`${lead(ic.branch, s.git.branch)}  ${counts.join('  ')}`, { hue: 'branch' }))
      if (withPr && s.pr) {
        const glyph = s.pr.checks === 'none' ? '' : ` ${s.pr.checks === 'ok' ? ic.ok : s.pr.checks === 'fail' ? ic.fail : ic.pending}`
        left.push({ text: ' ' }, chip(`${lead(ic.pr, `#${s.pr.number}`)}${glyph}`, { hue: 'pr' }))
      }
    }
    return edge(left, sessionRight(s, ic, false, withTime), columns)
  }
  const bottom = (free: boolean, word: boolean): Row => {
    const out: Row = []
    const add = (segs: Seg[]) => out.push(...(out.length > 0 ? [{ text: ' ' }] : []), ...segs)
    if (m.ctx !== null) add([chip(`ctx ${pct(m.ctx)}`, level(m.ctx, contextTone(m.ctx)))])
    if (m.five !== null) add([chip(`5h ${pct(m.five.p)}`, level(m.five.p, limitTone(m.five.p))), ...(m.five.reset === null ? [] : [{ text: `${word ? ' resets ' : ' '}${m.five.reset}`, dim: true }])])
    if (m.seven !== null) add([chip(`7d ${pct(m.seven)}`, level(m.seven, limitTone(m.seven)))])
    if (m.mem !== null) add([chip(lead(ic.mem === '' ? 'mem' : ic.mem, `${bytes(m.mem)}${free ? ' free' : ''}`), { tone: memoryTone(m.mem) })])
    return out
  }
  return [fitOne([top(true, true), top(true, false), top(false, false)], columns), fitOne([bottom(true, true), bottom(false, true), bottom(false, false)], columns)].filter((r) => r.length > 0)
}

// --- C: minimal ---

function minimal(s: Snapshot, columns: number): Row[] {
  const m = meters(s)
  const top = (withModel: boolean, withPr: boolean): Row => {
    const left: Row = []
    if (s.project !== null) left.push({ text: s.project, bold: true })
    if (s.git !== null) {
      left.push({ text: '  ' }, { text: s.git.branch, hue: 'branch' }, { text: '  ' }, ...join(countWords(s.git), { text: ' · ', dim: true }))
      if (withPr && s.pr) {
        const words = { ok: 'passing', fail: 'failing', pending: 'running', none: '' }[s.pr.checks]
        left.push({ text: '  ' }, { text: `PR #${s.pr.number}`, hue: 'pr' }, ...(words === '' ? [] : [{ text: ` ${words}`, tone: s.pr.checks === 'none' ? undefined : CHECK_TONE[s.pr.checks] } as Seg]))
      }
    } else if (s.project !== null) left.push({ text: '  ' }, { text: 'not a git repo', dim: true })
    const right: Row = []
    if (withModel && s.model !== null) right.push({ text: s.model })
    if (withModel && s.startedAt !== null) right.push({ text: ' · ', dim: true }, { text: age(s.now - s.startedAt), dim: true })
    return edge(left, right, columns)
  }
  const bottom = (cells: number, gapN: number, long: boolean): Row => {
    const g = ' '.repeat(gapN)
    const groups: Row[] = []
    if (m.ctx !== null) groups.push([{ text: long ? 'context ' : 'ctx ', dim: true }, ...bar(m.ctx, cells, contextTone(m.ctx), '━', '─'), { text: ` ${pct(m.ctx)}`, ...level(m.ctx, contextTone(m.ctx)) }])
    if (m.five !== null) groups.push([{ text: long ? '5-hour ' : '5h ', dim: true }, ...bar(m.five.p, cells, limitTone(m.five.p), '━', '─'), { text: ` ${pct(m.five.p)}`, ...level(m.five.p, limitTone(m.five.p)) }, ...(m.five.reset === null ? [] : [{ text: ` ${m.five.reset}`, dim: true }])])
    if (m.seven !== null) groups.push([{ text: long ? 'weekly ' : '7d ', dim: true }, ...bar(m.seven, cells, limitTone(m.seven), '━', '─'), { text: ` ${pct(m.seven)}`, ...level(m.seven, limitTone(m.seven)) }])
    if (m.mem !== null) groups.push([{ text: `${bytes(m.mem)} free`, dim: true }])
    return join(groups, { text: g })
  }
  return [
    fitOne([top(true, true), top(false, true), top(false, false)], columns),
    fitOne([bottom(10, 4, true), bottom(8, 3, true), bottom(8, 3, false), bottom(6, 3, false), bottom(4, 2, false)], columns),
  ].filter((r) => r.length > 0)
}

// --- D: compact ---

function compact(s: Snapshot, ic: Icons, columns: number): Row[] {
  const m = meters(s)
  const sep: Seg = { text: ' │ ', dim: true }
  const ident: Row = []
  if (s.project !== null) ident.push({ text: lead(ic.folder, s.project), bold: true })
  if (s.git !== null) {
    ident.push({ text: '  ' }, { text: lead(ic.branch, s.git.branch), hue: 'branch' }, { text: ' ' }, ...join(countSegs(s.git, ic), { text: ' ' }))
    if (s.pr) ident.push({ text: '  ' }, { text: lead(ic.pr, String(s.pr.number)), hue: 'pr' }, ...checkSeg(s.pr, ic))
  }
  const parts: Row[] = []
  if (m.ctx !== null) parts.push([{ text: `ctx ${pct(m.ctx)}`, ...level(m.ctx, contextTone(m.ctx)) }])
  if (m.five !== null) parts.push([{ text: `5h ${pct(m.five.p)}`, ...level(m.five.p, limitTone(m.five.p)) }, ...(m.five.reset === null ? [] : [{ text: ` ${lead(ic.clock, m.five.reset)}`, dim: true }])])
  if (m.seven !== null) parts.push([{ text: `7d ${pct(m.seven)}`, ...level(m.seven, limitTone(m.seven)) }])
  if (m.mem !== null) parts.push([{ text: lead(ic.mem === '' ? 'mem' : ic.mem, bytes(m.mem)), tone: memoryTone(m.mem) }])
  const model: Row = s.model === null ? [] : [{ text: lead(ic.model, s.model), dim: true }]
  const meterRow = join(parts, sep)
  const one: Row = [...ident, ...(ident.length > 0 && meterRow.length > 0 ? [sep] : []), ...meterRow, ...(model.length > 0 ? [sep, ...model] : [])]
  if (width(one) <= columns) return [one]
  return [edge(ident, model, columns), meterRow].filter((r) => r.length > 0)
}

// --- entry ---

export function statusRows(snapshot: Snapshot, style: StatusStyle, icons: IconSet, columns: number, colors: BarColor = 'gradient'): Row[] {
  barColor = colors
  const s = visible(snapshot)
  const ic = iconsOf(icons)
  switch (style) {
    case 'blocks':
      return blocks(s, ic, columns)
    case 'minimal':
      return minimal(s, columns)
    case 'compact':
      return compact(s, ic, columns)
    case 'refined':
      return refined(s, ic, columns)
    default: {
      const _exhaustive: never = style
      return String(_exhaustive) === '' ? [] : refined(s, ic, columns)
    }
  }
}
