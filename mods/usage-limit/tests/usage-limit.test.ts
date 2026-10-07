import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T20:00:00Z')
const RESET = '2026-10-06T22:30:00.000Z'

type Stubs = { submitted: string[]; running: number; initialUsage: number | null; stored?: Record<string, unknown> }

function windows(fiveHour: number) {
  return [
    { kind: 'five_hour', percentUsed: fiveHour, resetsAt: RESET },
    { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-11T16:00:00.000Z' },
  ]
}

// Registers the stubs that session.start and the rest of the mod ask for. Returns the clock and what the mod submitted.
function setup(on: Parameters<Parameters<typeof test>[1]>[1], s: Stubs) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home' })
  mock.store(on, s.stored ?? {})
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: s.initialUsage === null ? [] : windows(s.initialUsage) } }))
  on('command.register', () => ({ value: undefined }))
  on('fs.read', () => ({ deny: 'no file' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: Array.from({ length: s.running }, (_, i) => ({ id: `a${i}`, description: '', type: 'Explore', status: 'running' })) }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', () => ({ result: 'ran' }))
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `new${++n}` }))
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('prompt.submit', ($, e) => {
    s.submitted.push(e.text)
    return { text: e.text }
  })
  return clock
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('below the alert, tools and subagents pass', async ($, on) => {
  const s = { submitted: [], running: 3, initialUsage: 50 }
  setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'ran' })
  expect(await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'Explore' })).toMatchObject({ agentId: 'new1' })
})

test('above the alert, only one subagent runs at a time', async ($, on) => {
  const s = { submitted: [], running: 1, initialUsage: 91 }
  setup(on, s)
  await $.session.start(start)
  const refusal = await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'Explore' })
  expect(refusal).toMatchObject({ deny: expect.stringContaining('only one subagent') })
})

test('in the reserve, refuses tools and resumes when the window resets', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 97 }
  const clock = setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'ran' })

  await $.session.measure({ rateLimits: windows(98), context: { tokens: 0, window: 200000, percent: 0 }, changed: ['rateLimits'] })
  const refusal = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(refusal).toMatchObject({ deny: expect.stringContaining('98%') })
  expect(refusal).toMatchObject({ deny: expect.stringContaining('Oct 6, 19:30') })

  // The reset is 22:30 UTC, plus 2 min of margin. One minute before, nothing.
  await clock.set(Date.parse(RESET) + 60_000)
  expect(s.submitted.length).toBe(0)
  await clock.set(Date.parse(RESET) + 2 * 60_000)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('The limit has reset')

  // After the resume, tools pass again.
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'ran' })
})

test("in the reserve, the user's prompt gets one turn without subagents", async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 98 }
  setup(on, s)
  await $.session.start(start)
  const entered = await $.prompt.submit({ text: 'check the deploy', wait: false, origin: { kind: 'bridge' } })
  expect(entered).toMatchObject({ text: 'check the deploy' })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'ran' })
  expect(await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'Explore' })).toMatchObject({ deny: expect.stringContaining('reserve') })

  // End of the user's turn: the pause applies again.
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('Paused') })
})

test('in the reserve, an automatic prompt is held and goes into the resume', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 99 }
  const clock = setup(on, s)
  await $.session.start(start)
  const held = await $.prompt.submit({ text: 'routine: daily report', wait: false, origin: { kind: 'scheduled-trigger' } })
  expect(held).toMatchObject({ drop: expect.stringContaining('resume') })

  await clock.set(Date.parse(RESET) + 2 * 60_000)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('1. routine: daily report')
})

test('/limit shows the windows and the state', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 91 }
  setup(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'limit', args: '' })
  expect(r.text).toContain('throttled above 90%')
  expect(r.text).toContain('5-hour window: 91%, resets Oct 6, 19:30')
})

test('a new session without its own reading uses the one another session stored', async ($, on) => {
  const stored = { windows: { at: NOW - 30_000, windows: windows(98) } }
  const s = { submitted: [], running: 0, initialUsage: null, stored }
  setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('Paused') })
})

test('a stored reading of a window that already reset does not pause', async ($, on) => {
  const old = [{ kind: 'five_hour', percentUsed: 99, resetsAt: '2026-10-06T19:00:00.000Z' }]
  const s = { submitted: [], running: 0, initialUsage: null, stored: { windows: { at: NOW - 3_600_000, windows: old } } }
  setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'ran' })
})

test("/clear cancels the previous conversation's resume", async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 98 }
  const clock = setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('Paused') })
  await $.session.end({ reason: 'clear' })
  await clock.set(Date.parse(RESET) + 5 * 60_000)
  expect(s.submitted.length).toBe(0)
})

test('a window that resets while the session is idle lifts the pause without waiting for a new response', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 98 }
  const clock = setup(on, s)
  await $.session.start(start)
  await clock.set(Date.parse(RESET) + 1_000)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'ran' })
  expect(await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'scheduled-trigger' } })).toMatchObject({ text: 'hi' })
})

test('above the alert, two subagents requested together: only one starts', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 91 }
  setup(on, s)
  await $.session.start(start)
  const request = { prompt: 'read', description: 'read', subagentType: 'Explore' }
  const [a, b] = await Promise.all([$.agent.spawn(request), $.agent.spawn(request)])
  const refused = [a, b].filter((r) => 'deny' in r).length
  expect(refused).toBe(1)
})

test('a subagent that finished frees the slot', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 91 }
  setup(on, s)
  await $.session.start(start)
  const request = { prompt: 'read', description: 'read', subagentType: 'Explore' }
  expect(await $.agent.spawn(request)).toMatchObject({ agentId: 'new1' })
  expect(await $.agent.spawn(request)).toMatchObject({ deny: expect.stringContaining('only one subagent') })
  await $.turn.complete({ turnId: 't', agentId: 'new1', answer: 'ok', durationMs: 5, isAborted: false, usage: null })
  expect(await $.agent.spawn(request)).toMatchObject({ agentId: 'new2' })
})

test("in the reserve, a prompt with an unclassified origin counts as the user's", async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 98 }
  setup(on, s)
  await $.session.start(start)
  expect(await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'unclassified' } })).toMatchObject({ text: 'hi' })
})

test('a session that hit 100% with the limit error resumes when the window resets', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 100 }
  const clock = setup(on, s)
  on('classic.StopFailure', () => ({}))
  await $.session.start(start)
  await $.classic.StopFailure({ session_id: 's1', transcript_path: '/t', cwd: '/work', hook_event_name: 'StopFailure', error: 'rate_limit' })
  await clock.set(Date.parse(RESET) + 2 * 60_000)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('The limit has reset')
})
