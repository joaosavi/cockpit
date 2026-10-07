// The export's selection logic, with no file access, so the tests run it directly.

/** @param {string} text */
export function parseJsonl(text) {
  const out = []
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

// The last line for each turn wins.
function latest(rows) {
  const m = new Map()
  for (const r of rows) if (r && typeof r.turn === 'string') m.set(r.turn, r)
  return m
}

// The score of a turn: the user's when the source allows it, else the implicit one.
export function scoreOf(id, users, implicits, source) {
  const u = users.get(id)
  if (u !== undefined && (source === 'user' || source === 'both')) return { score: u.score, source: 'user' }
  const s = implicits.get(id)
  if (s !== undefined && (source === 'implicit' || source === 'both')) return { score: s.implicitScore, source: 'implicit' }
  return null
}

function prepare(data, opts) {
  const since = opts.since ?? ''
  const turns = data.turns.filter((t) => t && typeof t.id === 'string' && (since === '' || String(t.at).slice(0, 10) >= since))
  return { turns, users: latest(data.ratings), implicits: latest(data.signals), source: opts.source ?? 'user' }
}

export function selectSft(data, opts) {
  const { turns, users, implicits, source } = prepare(data, opts)
  const min = opts.minScore ?? 4
  const out = []
  for (const t of turns) {
    const s = scoreOf(t.id, users, implicits, source)
    if (s === null || s.score < min || t.answer === '' || t.aborted) continue
    out.push({
      messages: [
        { role: 'user', content: t.prompt },
        { role: 'assistant', content: t.answer },
      ],
      meta: { id: t.id, project: t.project, model: t.model, score: s.score, source: s.source, tools: (t.tools ?? []).map((x) => x.tool) },
    })
  }
  return out
}

export function selectReward(data, opts) {
  const { turns, users, implicits, source } = prepare(data, opts)
  const out = []
  for (const t of turns) {
    const s = scoreOf(t.id, users, implicits, source)
    if (s === null) continue
    out.push({ prompt: t.prompt, response: t.answer, score: s.score, source: s.source, id: t.id })
  }
  return out
}

// How many main turns after a bad one may hold its fixed version.
export const DPO_WINDOW = 3

function isFix(signal) {
  return signal !== undefined && (signal.signals?.retried === true || signal.signals?.correction === true)
}

// Pairs inside one session: a turn scored <= 2, then within the next 3 turns one scored >= 4, where
// every prompt in between retried or corrected the turn before it. The first such turn wins.
export function selectDpo(data, opts) {
  const { turns, users, implicits, source } = prepare(data, opts)
  const bySession = new Map()
  for (const t of turns) {
    const list = bySession.get(t.session) ?? []
    list.push(t)
    bySession.set(t.session, list)
  }
  const out = []
  for (const list of bySession.values()) {
    list.sort((a, b) => String(a.at).localeCompare(String(b.at)))
    for (let i = 0; i < list.length; i++) {
      const bad = list[i]
      const b = scoreOf(bad.id, users, implicits, source)
      if (b === null || b.score > 2) continue
      for (let j = i + 1; j <= i + DPO_WINDOW && j < list.length; j++) {
        // The prompt of turn j reacts to turn j-1: that turn's signals must say retry or correction.
        if (!isFix(implicits.get(list[j - 1].id))) break
        const good = list[j]
        const g = scoreOf(good.id, users, implicits, source)
        if (g === null || g.score < 4) continue
        out.push({ prompt: bad.prompt, chosen: good.answer, rejected: bad.answer, meta: { chosen: good.id, rejected: bad.id } })
        break
      }
    }
  }
  return out
}

export function select(format, data, opts) {
  if (format === 'sft') return selectSft(data, opts)
  if (format === 'dpo') return selectDpo(data, opts)
  if (format === 'reward') return selectReward(data, opts)
  throw new Error(`unknown format: ${format}`)
}
