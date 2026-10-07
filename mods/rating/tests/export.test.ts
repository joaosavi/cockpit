import { expect, test } from 'claude-code/testing'
import { parseJsonl, select } from '../bin/lib.mjs'

// Invented data only. Session s1: t1 bad, t2 corrects it and is good. Session s2: bad, then an
// unrelated good turn with no retry or correction in between, so no pair.
function turn(id: string, session: string, at: string, prompt: string, answer: string) {
  return { v: 1, id, session, at, project: 'acme', model: 'claude-test', prompt, answer, aborted: false, tools: [{ tool: 'Read' }, { tool: 'Edit' }] }
}

const signal = (turnId: string, implicitScore: number, s: Record<string, boolean> = {}) => ({
  v: 1,
  turn: turnId,
  at: 'x',
  signals: { aborted: false, retried: false, correction: false, approval: false, loopNudges: 0, toolErrors: 0, refusals: 0, ...s },
  implicitScore,
  source: 'implicit',
})

const rating = (turnId: string, score: number) => ({ v: 1, turn: turnId, score, tags: [], at: 'x', source: 'user' })

const data = {
  turns: [
    turn('s1:t1', 's1', '2026-10-01T10:00:00Z', 'sum the october invoices', 'The total is 10.'),
    turn('s1:t2', 's1', '2026-10-01T10:05:00Z', 'wrong, sum only the paid october invoices', 'The paid total is 7.'),
    turn('s1:t3', 's1', '2026-10-01T10:10:00Z', 'thanks, now export it', 'Exported.'),
    turn('s2:t1', 's2', '2026-10-02T09:00:00Z', 'rename the column', 'Renamed the wrong one.'),
    turn('s2:t2', 's2', '2026-10-02T09:05:00Z', 'deploy the app', 'Deployed.'),
  ],
  ratings: [rating('s1:t1', 4), rating('s1:t1', 1), rating('s1:t2', 5), rating('s2:t1', 2), rating('s2:t2', 5)],
  signals: [signal('s1:t1', 1.5, { correction: true }), signal('s1:t2', 4.5, { approval: true }), signal('s1:t3', 4), signal('s2:t1', 3)],
}

test('parses JSONL and skips a cut line', () => {
  expect(parseJsonl('{"a":1}\n\n{"b":\n{"c":3}\n')).toEqual([{ a: 1 }, { c: 3 }])
})

test('sft keeps turns scored at or above the minimum, user score first, implicit only when allowed', () => {
  const user = select('sft', data, { minScore: 4, source: 'user' })
  expect(user.map((r: { meta: { id: string } }) => r.meta.id)).toEqual(['s1:t2', 's2:t2'])
  expect(user[0]).toEqual({
    messages: [
      { role: 'user', content: 'wrong, sum only the paid october invoices' },
      { role: 'assistant', content: 'The paid total is 7.' },
    ],
    meta: { id: 's1:t2', project: 'acme', model: 'claude-test', score: 5, source: 'user', tools: ['Read', 'Edit'] },
  })
  const both = select('sft', data, { minScore: 4, source: 'both' })
  expect(both.map((r: { meta: { id: string; source: string } }) => `${r.meta.id}:${r.meta.source}`)).toEqual(['s1:t2:user', 's1:t3:implicit', 's2:t2:user'])
  const since = select('sft', data, { minScore: 4, source: 'both', since: '2026-10-02' })
  expect(since.length).toBe(1)
})

test('reward lists every scored turn with its source', () => {
  const rows = select('reward', data, { source: 'implicit' })
  expect(rows.length).toBe(4)
  expect(rows[0]).toEqual({ prompt: 'sum the october invoices', response: 'The total is 10.', score: 1.5, source: 'implicit', id: 's1:t1' })
})

test('dpo pairs a bad turn with the good retry or correction that follows it in the same session', () => {
  const rows = select('dpo', data, { source: 'user' })
  expect(rows).toEqual([
    { prompt: 'sum the october invoices', chosen: 'The paid total is 7.', rejected: 'The total is 10.', meta: { chosen: 's1:t2', rejected: 's1:t1' } },
  ])
})

test('dpo follows a chain of corrections up to 3 turns, and stops at a prompt that is neither', () => {
  const chain = {
    turns: [
      turn('c:1', 'c', '2026-10-03T10:00:00Z', 'p1', 'a1'),
      turn('c:2', 'c', '2026-10-03T10:01:00Z', 'p2', 'a2'),
      turn('c:3', 'c', '2026-10-03T10:02:00Z', 'p3', 'a3'),
      turn('c:4', 'c', '2026-10-03T10:03:00Z', 'p4', 'a4'),
    ],
    ratings: [rating('c:1', 1), rating('c:2', 2), rating('c:3', 5), rating('c:4', 5)],
    signals: [signal('c:1', 2, { retried: true }), signal('c:2', 2, { correction: true }), signal('c:3', 4)],
  }
  expect(select('dpo', chain, { source: 'user' }).map((r: { meta: unknown }) => r.meta)).toEqual([
    { chosen: 'c:3', rejected: 'c:1' },
    { chosen: 'c:3', rejected: 'c:2' },
  ])
  const broken = { ...chain, signals: [signal('c:1', 2, { retried: true }), signal('c:2', 2), signal('c:3', 4)] }
  expect(select('dpo', broken, { source: 'user' })).toEqual([])
})
