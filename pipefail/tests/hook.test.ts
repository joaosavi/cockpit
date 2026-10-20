import { expect, mock, test } from 'claude-code/testing'

type Scene = { ran: string[]; written: Map<string, string> }

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene, env: Record<string, string> = { HOME: '/home' }) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-07T13:00:00Z') })
  mock.env(on, env)
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('fs.read', ($, e) => {
    const text = s.written.get(e.path)
    return text === undefined ? { deny: 'no file' } : { value: text }
  })
  on('fs.write', ($, e) => {
    s.written.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('tool.call', ($, e) => {
    s.ran.push(String(Reflect.get(e, 'command')))
    return { result: 'ok', text: 'ok' }
  })
  return clock
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const DIARY = '/home/.local/state/mods/pipefail/2026-10-07-abcdef12.jsonl'

function lines(s: Scene): unknown[] {
  return (s.written.get(DIARY) ?? '').trim().split('\n').filter((l) => l !== '').map((l): unknown => JSON.parse(l))
}

test('the hook runs the rewritten command and tells the agent', async ($, on) => {
  const s = { ran: [], written: new Map<string, string>() }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn vitest run 2>&1 | tail -5' })
  expect(s.ran).toEqual(['set -o pipefail; yarn vitest run 2>&1 | tail -5'])
  expect(r).toMatchObject({ context: [expect.stringContaining('set -o pipefail')] })
  await $.tool.call({ tool: 'Bash', command: 'ls | head' })
  expect(s.ran[1]).toBe('ls | head')
})

test('the diary names the runner of each rewrite, and the session ends with one summary line', async ($, on) => {
  const s = { ran: [], written: new Map<string, string>() }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn vitest run src/a.test.ts 2>&1 | tail -5' })
  await $.tool.call({ tool: 'Bash', command: 'ls | head' })
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit -p . | head -30' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const all = lines(s)
  expect(all[0]).toEqual({ at: '2026-10-07T13:00:00.000Z', session: 'abcdef12', event: 'rewritten', key: 'yarn vitest' })
  expect(all[1]).toMatchObject({ event: 'rewritten', key: 'npx tsc' })
  expect(all.length).toBe(3)
  expect(all[2]).toEqual({
    at: '2026-10-07T13:00:00.000Z',
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work',
    toolCalls: 3,
    actions: { rewritten: 2 },
    hookMs: 0,
    maxHookMs: 0,
  })
})

const EXTRA = { options: { extraRunners: ['verify', 'rules'] } }

test('disabled, the mod leaves the command alone and writes no diary', { options: { enabled: false } }, async ($, on) => {
  const s = { ran: [], written: new Map<string, string>() }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn vitest run 2>&1 | tail -5' })
  expect(s.ran).toEqual(['yarn vitest run 2>&1 | tail -5'])
  expect(s.written.has(DIARY)).toBe(false)
})

test('with extraRunners set, a piped repo check script is rewritten', EXTRA, async ($, on) => {
  const s = { ran: [], written: new Map<string, string>() }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'git add -A && yarn verify 2>&1 | grep -E "FAIL|all green"' })
  await $.tool.call({ tool: 'Bash', command: 'yarn rules 2>&1 | head -20' })
  expect(s.ran).toEqual(['set -o pipefail; git add -A && yarn verify 2>&1 | grep -E "FAIL|all green"', 'set -o pipefail; yarn rules 2>&1 | head -20'])
  expect(lines(s)[1]).toMatchObject({ event: 'rewritten', key: 'yarn rules' })
})

test('without extraRunners, a piped repo check script runs as written', async ($, on) => {
  const s = { ran: [], written: new Map<string, string>() }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn verify 2>&1 | grep FAIL' })
  expect(s.ran).toEqual(['yarn verify 2>&1 | grep FAIL'])
})

test('without HOME, as on Windows, the diary goes under USERPROFILE', async ($, on) => {
  const s = { ran: [], written: new Map<string, string>() }
  prepare(on, s, { USERPROFILE: '/users/u' })
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn vitest run 2>&1 | tail -5' })
  expect([...s.written.keys()]).toEqual(['/users/u/.local/state/mods/pipefail/2026-10-07-abcdef12.jsonl'])
})
