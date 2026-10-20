import { expect, mock, test } from 'claude-code/testing'
import { nudgeText, signature } from '../hooks/rules.ts'

test('the same error gets the same signature across runs', () => {
  const a = 'FAIL src/a.test.ts > soma\nAssertionError: expected 3 to be 4 at /w/src/a.test.ts:12:5\nTests 1 failed (1) 2.31s'
  const b = 'FAIL src/a.test.ts > soma\nAssertionError: expected 3 to be 4 at /w/src/a.test.ts:14:9\nTests 1 failed (1) 1.87s'
  const c = "TypeError: cannot read properties of undefined (reading 'x')"
  expect(signature(a)).toBe(signature(b))
  expect(signature(a) === signature(c)).toBe(false)
})

type Scene = { results: Array<{ text: string; isError?: boolean }>; written?: string[] }

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene) {
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ deny: 'no file' }))
  on('fs.write', ($, e) => {
    s.written?.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => {
    const next = s.results.shift() ?? { text: 'ok' }
    return next.isError === true ? { isError: true, result: next.text, text: next.text } : { result: next.text, text: next.text }
  })
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const FAIL = { text: 'Exit code 1\nAssertionError: expected 3 to be 4 at /w/a.test.ts:12:5', isError: true }

function hasNudge(r: unknown): boolean {
  if (typeof r !== 'object' || r === null) return false
  const ctx: unknown = Reflect.get(r, 'context')
  return Array.isArray(ctx) && ctx.some((c) => typeof c === 'string' && c.includes('Loop check'))
}

test('the same error three times gets the nudge on the third', async ($, on) => {
  const s = { results: [FAIL, FAIL, FAIL] }
  prepare(on, s)
  await $.session.start(start)
  expect(hasNudge(await $.tool.call({ tool: 'Bash', command: 'yarn test a' }))).toBe(false)
  expect(hasNudge(await $.tool.call({ tool: 'Bash', command: 'yarn test b' }))).toBe(false)
  const third = await $.tool.call({ tool: 'Bash', command: 'yarn test c' })
  expect(hasNudge(third)).toBe(true)
  expect(third).toMatchObject({ context: [expect.stringContaining('the same error came back 3 times')] })
})

test('five fix attempts on one file get the nudge, with reads in between', async ($, on) => {
  const results = []
  for (let i = 0; i < 5; i += 1) results.push({ text: `Exit code 1\nerror number ${'x'.repeat(i)}`, isError: true }, { text: 'file' }, { text: 'edited' })
  const s = { results }
  prepare(on, s)
  await $.session.start(start)
  let last: unknown = null
  for (let i = 0; i < 5; i += 1) {
    await $.tool.call({ tool: 'Bash', command: `yarn test ${i}` })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', offset: i })
    last = await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: `a${i}`, new_string: `b${i}` })
  }
  expect(last).toMatchObject({ context: [expect.stringContaining('edited /w/a.ts 5 times after failed commands')] })
})

test('a refactor with many edits and no failures gets no nudge', async ($, on) => {
  const s = { results: [] }
  prepare(on, s)
  await $.session.start(start)
  for (let i = 0; i < 10; i += 1) {
    expect(hasNudge(await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: `a${i}`, new_string: `b${i}` }))).toBe(false)
  }
})

test('the same call three times in a row gets the nudge', async ($, on) => {
  const s = { results: [] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'gh run view 1' })
  await $.tool.call({ tool: 'Bash', command: 'gh run view 1' })
  expect(await $.tool.call({ tool: 'Bash', command: 'gh run view 1' })).toMatchObject({ context: [expect.stringContaining('same arguments 3 times in a row')] })
})

test('a check turned off gives no nudge, and the others still work', { options: { repeatCheck: false } }, async ($, on) => {
  const s = { results: [{ text: 'file' }, { text: 'file' }, { text: 'file' }, FAIL, FAIL, FAIL] }
  prepare(on, s)
  await $.session.start(start)
  for (let i = 0; i < 3; i += 1) expect(hasNudge(await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' }))).toBe(false)
  await $.tool.call({ tool: 'Bash', command: 'yarn test a' })
  await $.tool.call({ tool: 'Bash', command: 'yarn test b' })
  expect(hasNudge(await $.tool.call({ tool: 'Bash', command: 'yarn test c' }))).toBe(true)
})

test('disabled, the mod adds no nudge', { options: { enabled: false } }, async ($, on) => {
  const s = { results: [FAIL, FAIL, FAIL] }
  prepare(on, s)
  await $.session.start(start)
  for (const c of ['a', 'b', 'c']) expect(hasNudge(await $.tool.call({ tool: 'Bash', command: `yarn test ${c}` }))).toBe(false)
})

test('the end of the turn resets the counts', async ($, on) => {
  const s = { results: [FAIL, FAIL, FAIL] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn test a' })
  await $.tool.call({ tool: 'Bash', command: 'yarn test b' })
  await $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false })
  expect(hasNudge(await $.tool.call({ tool: 'Bash', command: 'yarn test c' }))).toBe(false)
})

test('a subagent has its own counts', async ($, on) => {
  const s = { results: [FAIL, FAIL, FAIL] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn test a' })
  await $.tool.call({ tool: 'Bash', command: 'yarn test b' })
  expect(hasNudge(await $.tool.call({ tool: 'Bash', command: 'yarn test c', agentId: 'sub1' }))).toBe(false)
})

test('a failure hidden by a pipe still counts, and an unrelated command does not clear it', async ($, on) => {
  const piped = { text: 'AssertionError: soma(2, 2) expected 5, got 4\n    at check (/tmp/x/spec.js:42:7)' }
  const results = []
  for (let i = 0; i < 5; i += 1) results.push(piped, { text: 'a.js teste.js' }, { text: 'edited' })
  const s = { results }
  prepare(on, s)
  await $.session.start(start)
  let last: unknown = null
  for (let i = 0; i < 5; i += 1) {
    await $.tool.call({ tool: 'Bash', command: `node teste.js 2>&1 | head -${i + 1}` })
    await $.tool.call({ tool: 'Bash', command: `ls -la ${i}` })
    last = await $.tool.call({ tool: 'Edit', file_path: '/w/a.js', old_string: `a${i}`, new_string: `b${i}` })
  }
  expect(last).toMatchObject({ context: [expect.stringContaining('edited /w/a.js 5 times')] })
})

test('the failing check passing again stops counting edits as fix attempts', async ($, on) => {
  const s = { results: [FAIL, { text: 'edited' }, { text: 'all passed' }] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn test' })
  await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'yarn test 2>&1 | tail -3' })
  for (let i = 0; i < 6; i += 1) {
    expect(hasNudge(await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: `c${i}`, new_string: `d${i}` }))).toBe(false)
  }
})

test('the session ends with one summary line: calls seen and nudges by kind', async ($, on) => {
  const written: string[] = []
  const s = { results: [FAIL, FAIL, FAIL], written }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn test a' })
  await $.tool.call({ tool: 'Bash', command: 'yarn test b' })
  await $.tool.call({ tool: 'Bash', command: 'yarn test c' })
  await $.tool.call({ tool: 'Bash', command: 'gh run view 1' })
  await $.tool.call({ tool: 'Bash', command: 'gh run view 1' })
  await $.tool.call({ tool: 'Bash', command: 'gh run view 1' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  expect(JSON.parse(written.at(-1) ?? '{}')).toEqual({
    at: '1970-01-01T00:00:00.000Z',
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work',
    toolCalls: 6,
    actions: { 'nudge:error': 1, 'nudge:repeat': 1 },
    hookMs: 0,
    maxHookMs: 0,
  })
})

test('each nudge names what repeated and tells the agent how to change approach', () => {
  const tail =
    'Stop and write in up to 3 lines what you tried and why it failed. ' +
    'Then change approach: re-read the code around the failure, test a new hypothesis, or ask the user if blocked.'
  expect(nudgeText({ kind: 'edits', file: '/w/a.ts', count: 5 })).toBe(`Loop check: you edited /w/a.ts 5 times after failed commands this turn. ${tail}`)
  expect(nudgeText({ kind: 'error', count: 3 })).toBe(`Loop check: the same error came back 3 times this turn. ${tail}`)
  expect(nudgeText({ kind: 'repeat', tool: 'Bash', count: 3 })).toBe(`Loop check: you called Bash with the same arguments 3 times in a row. ${tail}`)
})
