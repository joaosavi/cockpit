import { expect, mock, test } from 'claude-code/testing'
import { bandRows, DEFAULTS, formatTime, isCommitCommand, limitReport, options, statusText, windowName } from '../hooks/rules.ts'

const NOW = Date.parse('2026-10-06T20:00:00Z')
const RESET = '2026-10-06T22:30:00.000Z'

// The expected times are written in one fixed zone, so the tests pass on any machine.
const SAO_PAULO = { options: { timeZone: 'America/Sao_Paulo' } }
const O = { ...DEFAULTS, timeZone: 'America/Sao_Paulo' }

type Stubs = { submitted: string[]; running: number; initialUsage: number | null; stored?: Record<string, unknown>; written?: string[]; contexts?: string[] }

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
  on('fs.write', ($, e) => {
    s.written?.push(e.text)
    return { value: undefined }
  })
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
    s.contexts?.push(...(e.context ?? []))
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

test('in the reserve, refuses tools and resumes when the window resets', SAO_PAULO, async ($, on) => {
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
  expect(s.submitted[0]).toContain('the limit reset')

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
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('paused at') })
})

test('in the reserve, an automatic prompt is held and goes into the resume', SAO_PAULO, async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 99 }
  const clock = setup(on, s)
  await $.session.start(start)
  const held = await $.prompt.submit({ text: 'routine: daily report', wait: false, origin: { kind: 'scheduled-trigger' } })
  expect(held).toMatchObject({ drop: 'usage-limit: held during the reserve, delivered when the session resumes at Oct 6, 19:30.' })

  await clock.set(Date.parse(RESET) + 2 * 60_000)
  expect(s.submitted.length).toBe(1)
  expect(s.submitted[0]).toContain('1. routine: daily report')
})

test('/limit shows the windows and the state', SAO_PAULO, async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 91 }
  setup(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'limit', args: '' })
  expect(r.text).toBe(
    'Throttled at 91%, one subagent at a time from 90%\n5-hour window: 91%, resets Oct 6, 19:30\n7-day window: 40%, resets Oct 11, 13:00',
  )
})

test('/limit reads in plain words in every state', () => {
  const none = { isResumeScheduled: false, held: 0 }
  expect(limitReport([], { kind: 'free' }, O, none)).toBe('No reading yet. It arrives with the first model response.')
  expect(limitReport(windows(50), { kind: 'free' }, O, none).split('\n')[0]).toBe('Normal, one subagent at a time from 90%, pause at 98%')
  const paused = { kind: 'paused', window: windows(98)[0] ?? { kind: 'five_hour', percentUsed: 98 } } as const
  expect(limitReport(windows(98), paused, O, { isResumeScheduled: true, held: 2 })).toBe(
    [
      'Paused at 98% (2% reserve), resumes Oct 6, 19:30',
      '5-hour window: 98%, resets Oct 6, 19:30',
      '7-day window: 40%, resets Oct 11, 13:00',
      'Resume scheduled for the window reset.',
      '2 messages held for the resume.',
    ].join('\n'),
  )
  expect(statusText({ kind: 'free' }, O)).toBeUndefined()
  expect(statusText(paused, O)).toBe('Usage limit: paused at 98% (2% reserve), resumes Oct 6, 19:30')
  expect(windowName('seven_day_opus')).toBe('seven day opus window')
})

test('a new session without its own reading uses the one another session stored', async ($, on) => {
  const stored = { windows: { at: NOW - 30_000, windows: windows(98) } }
  const s = { submitted: [], running: 0, initialUsage: null, stored }
  setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('paused at') })
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
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('paused at') })
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
  expect(s.submitted[0]).toContain('the limit reset')
})

const BAND = {
  plugin: 'usage-limit',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const OTHER_MODS = { type: 'Text', props: {}, children: ['drawn by another mod'] }

test('the band shows each window with its bar and percent at 91%, and keeps the other mods', SAO_PAULO, async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 91 }
  setup(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  const ui = await $.ui.mount(BAND)
  const percent = await ui.find({ type: 'Text', text: '91%' })
  expect(percent).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5-hour' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets Oct 6, 19:30/ })).toBeDefined()
  // Each bar stops at 40 columns, though the band has 80: two rows of 40 cells.
  const cells = (await ui.findAll({ type: 'Text', text: /^[█░│]+$/ })).map((t) => t.text).join('')
  expect(cells.length).toBe(80)
  // The used part of the 5-hour bar is yellow, past the 90% alert, and the pause mark sits at 98%.
  expect(await ui.find({ type: 'Text', text: /^█+$/ })).toMatchObject({ props: { color: 'warning' } })
  expect(await ui.find({ type: 'Text', text: '│' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'drawn by another mod' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Paused/ })).toBeUndefined()
})

test('the band stays hidden at 50%', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 50 }
  setup(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  const ui = await $.ui.mount(BAND)
  expect(await ui.drawn()).toMatchObject(OTHER_MODS)
  expect(await ui.find({ type: 'Text', text: '50%' })).toBeUndefined()
})

test('the band adds a red paused row at 98%, and redraws when the window changes', SAO_PAULO, async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 50 }
  setup(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /Paused/ })).toBeUndefined()
  await $.session.measure({ rateLimits: windows(98), context: { tokens: 0, window: 200000, percent: 0 }, changed: ['rateLimits'] })
  expect(await ui.find({ type: 'Text', text: 'Paused: resumes Oct 6, 19:30' })).toMatchObject({ props: { color: 'error' } })
  expect(await ui.find({ type: 'Text', text: /^█+$/ })).toMatchObject({ props: { color: 'error' } })
})

test('from bandFrom (75% by default), the band shows, green below the alert', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 80 }
  setup(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  const ui = await $.ui.mount(BAND)
  // 80% is past the default of 75, below the 90% alert: green.
  expect(await ui.find({ type: 'Text', text: /^█+$/ })).toMatchObject({ props: { color: 'success' } })
})

test('narrow or wide, both bars get the same width, so marks, percents and reset times line up', () => {
  for (const columns of [50, 80, 200]) {
    const rows = bandRows(windows(91), columns, O)
    const widths = rows.map((r) => r.runs.map((x) => x.text).join('').length)
    expect(widths[0]).toBe(widths[1])
    expect((widths[0] ?? 0) <= 40).toBe(true)
    expect(rows.map((r) => r.label.length + (widths[0] ?? 0) + r.percent.length)).toEqual([7 + (widths[0] ?? 0) + 5, 7 + (widths[0] ?? 0) + 5])
  }
  expect(bandRows(windows(91), 200, O)[0]?.runs.map((x) => x.text).join('').length).toBe(40)
  expect(bandRows(windows(91), 50, O)[0]?.runs.map((x) => x.text).join('').length).toBe(16)
})

test('the session ends with one summary line: tool calls, what the mod held back, and its own time', async ($, on) => {
  const written: string[] = []
  const s = { submitted: [], running: 0, initialUsage: 96, written }
  setup(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.session.measure({ rateLimits: windows(98), context: { tokens: 0, window: 200000, percent: 0 }, changed: ['rateLimits'] })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.agent.spawn({ prompt: 'read', description: 'read', subagentType: 'Explore' })
  await $.prompt.submit({ text: 'routine', wait: false, origin: { kind: 'scheduled-trigger' } })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const last: unknown = JSON.parse(written.at(-1) ?? '{}')
  expect(last).toEqual({
    at: '2026-10-06T20:00:00.000Z',
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work',
    toolCalls: 2,
    actions: { paused: 1, 'tool-refused': 1, 'resume-scheduled': 1, 'subagent-refused': 1, 'prompt-held': 1 },
    hookMs: 0,
    maxHookMs: 0,
  })
  expect(written.filter((l) => l.includes('session-summary')).length).toBe(1)
})

test('an empty or unknown time zone falls back to the system time zone', () => {
  expect(options({}).timeZone).toBe('')
  expect(options({ timeZone: 'Nowhere/Invented' }).timeZone).toBe('')
  expect(options({ timeZone: ' America/New_York ' }).timeZone).toBe('America/New_York')
  const iso = '2026-10-06T22:30:00.000Z'
  const local = new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  expect(formatTime(iso, '')).toBe(local)
  expect(formatTime(iso, 'America/New_York')).toBe('Oct 6, 18:30')
})

test('from 97%, the main conversation is asked once per window to commit without pushing', async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 96 }
  setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })
  await $.session.measure({ rateLimits: windows(97), context: { tokens: 0, window: 200000, percent: 0 }, changed: ['rateLimits'] })
  // A subagent's call does not get the request.
  expect(await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'sub1' })).toEqual({ result: 'ran' })
  const asked = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(asked).toMatchObject({ result: 'ran', context: [expect.stringContaining('commit the work in progress')] })
  expect(asked).toMatchObject({ context: [expect.stringContaining('Do not push')] })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })
})

test('a prompt at 97% carries the request to commit, and commitAt 0 turns it off', async ($, on) => {
  const s = { submitted: [] as string[], running: 0, initialUsage: 97, contexts: [] as string[] }
  setup(on, s)
  await $.session.start(start)
  const r = await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'bridge' } })
  expect(r).toMatchObject({ text: 'go on' })
  expect(s.contexts).toEqual([expect.stringContaining('commit the work in progress')])
  expect(options({ commitAt: 0 }).commitAt).toBe(0)
  expect(options({}).commitAt).toBe(97)
})

test('commitAt 0 never asks to commit', { options: { commitAt: 0 } }, async ($, on) => {
  const s = { submitted: [], running: 0, initialUsage: 97 }
  setup(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'ran' })
})

test('in the pause, a commit-only command passes and schedules the resume; a push does not', async ($, on) => {
  const s = { submitted: [] as string[], running: 0, initialUsage: 98 }
  const clock = setup(on, s)
  await $.session.start(start)
  const commit = 'cd /work/repo && git add -A && git commit --no-verify -m "wip: pause at 98% (usage)"'
  expect(await $.tool.call({ tool: 'Bash', command: commit })).toMatchObject({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Bash', command: 'git push' })).toMatchObject({ deny: expect.stringContaining('paused at') })
  // Windows without Git Bash commits through the PowerShell tool.
  expect(await $.tool.call({ tool: 'PowerShell', command: 'git -C C:\\work\\repo commit -am "wip: pause"' } as never)).toMatchObject({ result: 'ran' })
  expect(await $.tool.call({ tool: 'PowerShell', command: 'git push' } as never)).toMatchObject({ deny: expect.stringContaining('paused at') })
  await clock.set(Date.parse(RESET) + 2 * 60_000)
  expect(s.submitted.length).toBe(1)
})

test('only staging and committing count as a commit command', () => {
  expect(isCommitCommand('git add -A && git commit -m "wip: x"')).toBe(true)
  expect(isCommitCommand('git -C /work/repo commit -am "wip: (half) done"')).toBe(true)
  expect(isCommitCommand('git add -A')).toBe(false)
  expect(isCommitCommand('git commit -m x && git push')).toBe(false)
  expect(isCommitCommand('git commit -m "$(rm -rf /)"')).toBe(false)
  expect(isCommitCommand('git commit -m x; rm -rf /')).toBe(false)
  expect(isCommitCommand('git commit -m x | tee log')).toBe(false)
  expect(isCommitCommand('npm test && git commit -m x')).toBe(false)
})

test('resume off: no resume after the pause, and an automatic prompt is dropped', { options: { resume: false } }, async ($, on) => {
  const s = { submitted: [] as string[], running: 0, initialUsage: 98 }
  const clock = setup(on, s)
  await $.session.start(start)
  const refusal = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(refusal).toMatchObject({ deny: expect.stringContaining('the user resumes it') })
  expect(await $.prompt.submit({ text: 'routine', wait: false, origin: { kind: 'scheduled-trigger' } })).toMatchObject({
    drop: 'usage-limit: paused, and resume is off, so this message was not delivered.',
  })
  await clock.set(Date.parse(RESET) + 5 * 60_000)
  expect(s.submitted.length).toBe(0)
})

test('the old resumeOnError setting still turns the resume off', () => {
  expect(options({ resumeOnError: false }).resume).toBe(false)
  expect(options({ resume: true, resumeOnError: false }).resume).toBe(true)
  expect(options({}).resume).toBe(true)
})
