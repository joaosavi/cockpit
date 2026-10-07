import { expect, mock, test } from 'claude-code/testing'
import { actionsText, duration, fileDay, inWindow, parseDays } from '../hooks/rules.ts'

const ROOT = '/home/.local/state/mods'

function summary(session: string, toolCalls: number, actions: Record<string, number>, hookMs: number, maxHookMs: number, extra: Record<string, number> = {}): string {
  return JSON.stringify({ at: '2026-10-07T12:00:00.000Z', event: 'session-summary', session, cwd: '/work', toolCalls, actions, hookMs, maxHookMs, ...extra })
}

function call(server: string, outcome: string): string {
  return JSON.stringify({ at: '2026-10-07T11:00:00.000Z', session: 'aaaa1111', cwd: '/work', server, action: 'send', input: {}, outcome, ms: 5 })
}

// A week of diaries, with one file out of the 7-day window and one session still open.
const FILES: Record<string, Record<string, string>> = {
  'usage-limit': {
    '2026-10-07-aaaa1111.jsonl': [JSON.stringify({ at: 'x', event: 'tool-refused', tool: 'Bash' }), summary('aaaa1111', 100, { paused: 1, resumed: 1, 'tool-refused': 2, 'resume-scheduled': 1 }, 50, 4)].join('\n'),
    '2026-10-06-bbbb2222.jsonl': summary('bbbb2222', 50, {}, 25, 3),
    '2026-09-01-cccc3333.jsonl': summary('cccc3333', 999, { paused: 9 }, 99_999, 999),
    '2026-10-07-dddd4444.jsonl': JSON.stringify({ at: 'x', event: 'zone', from: 'free', to: 'throttled' }),
  },
  'memory-guard': {
    '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 10, { waited: 2, refused: 1, reduced: 1 }, 30, 8, { waitedMs: 130_000, refused: 1 }),
  },
  'skill-loader': {
    '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 100, { 'loaded:typescript-best-practices': 2, 'loaded:writing-for-agents': 1, refused: 1 }, 40, 2),
  },
  audit: {
    '2026-10-07.jsonl': [call('claude_ai_Slack', 'ok'), call('claude_ai_Slack', 'ok'), call('claude_ai_Gmail', 'error'), summary('aaaa1111', 5, { recorded: 3 }, 5, 2)].join('\n'),
    'notes.txt': 'not a diary',
  },
  'loop-breaker': {
    '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 100, { 'nudge:error': 1, 'nudge:repeat': 2 }, 10, 1),
  },
  'secret-guard': {
    '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 100, { redacted: 4, restored: 1 }, 3500, 120),
  },
  pipefail: {
    '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 20, { rewritten: 2 }, 2, 1),
  },
}

type Scene = { files: Record<string, Record<string, string>>; surfaces?: string[]; opened?: string[] }

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene) {
  mock.clock(on, { now: Date.parse('2026-10-07T15:00:00Z') })
  mock.env(on, { HOME: '/home' })
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.surfaces', () => ({ value: s.surfaces ?? [] }))
  on('ui.open', ($, e) => {
    s.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.list', ($, e) => {
    if (e.path === ROOT) return { value: Object.keys(s.files).map((name) => ({ name, kind: 'dir', size: 0, isLink: false })) }
    const mod = e.path.slice(ROOT.length + 1)
    const files = s.files[mod]
    return files === undefined ? { deny: 'ENOENT' } : { value: Object.keys(files).map((name) => ({ name, kind: 'file', size: 0, isLink: false })) }
  })
  on('fs.read', ($, e) => {
    const [mod, name] = e.path.slice(ROOT.length + 1).split('/')
    const text = mod === undefined || name === undefined ? undefined : s.files[mod]?.[name]
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('the window, the day in a diary name and the days argument', () => {
  expect(fileDay('2026-10-07-abcdef12.jsonl')).toBe('2026-10-07')
  expect(fileDay('2026-10-07.jsonl')).toBe('2026-10-07')
  expect(fileDay('notes.txt')).toBeNull()
  expect(inWindow('2026-10-01-a.jsonl', '2026-10-07', 7)).toBe(true)
  expect(inWindow('2026-09-30-a.jsonl', '2026-10-07', 7)).toBe(false)
  expect(parseDays('')).toBe(7)
  expect(parseDays(' 30 ')).toBe(30)
  expect(parseDays('0')).toBe(1)
  expect(parseDays('abc')).toBe(7)
  expect(duration(130_000)).toBe('2m 10s')
  expect(actionsText({ 'loaded:a': 1, 'loaded:b': 3, refused: 2 })).toBe('loaded: b 3, a 1 · refused 2')
})

test('/mods sums each mod over the window and flags what gets in the way', async ($, on) => {
  const s: Scene = { files: FILES }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'mods', args: '' })
  const text = r.text ?? ''
  const lines = text.split('\n')
  expect(lines.length <= 40).toBe(true)
  expect(lines[0]).toBe('Mod report, last 7 days (Oct 1 to Oct 7)')
  // The September file is out; the open session is counted apart.
  expect(text).toContain('usage-limit: 2 sessions, 1 still open, 150 tool calls, 0.5 ms per call (max 4 ms)')
  expect(text).toContain('  1 pause · 1 resume · tool-refused 2 · resume-scheduled 1')
  expect(text).toContain('memory-guard: 1 session, 10 tool calls, 3 ms per call (max 8 ms)')
  expect(text).toContain('  held 2m 10s over 2 commands · refused 1 · reduced 1')
  expect(text).toContain('  loaded: typescript-best-practices 2, writing-for-agents 1 · refused 1')
  expect(text).toContain('  writes: Slack 2, Gmail 1 · 1 failed or denied')
  expect(text).toContain('secret-guard: 1 session, 100 tool calls, 35 ms per call (max 120 ms)')
  expect(text).toContain('  rewritten 2')
  expect(text).not.toContain('999')
  const flags = text.slice(text.indexOf('Needs attention'))
  expect(flags).toContain('secret-guard: 35 ms per tool call, above 20 ms')
  expect(flags).toContain('memory-guard: refused 1 command, 2m 10s held in all')
  expect(flags).toContain('skill-loader: held 1 write to deliver a skill, redone by the agent')
  expect(flags).toContain('loop-breaker: 3 nudges (repeat 2, error 1)')
  expect(flags).toContain('usage-limit: 1 pause, 1 resume')
  expect(flags).not.toContain('pipefail')
})

test('/mods 1 keeps only today, and nothing to flag says so', async ($, on) => {
  const s: Scene = { files: { pipefail: { '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 20, { rewritten: 2 }, 2, 1), '2026-10-06-bbbb2222.jsonl': summary('bbbb2222', 5, {}, 1, 1) } } }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'mods', args: '1' })
  expect(r.text).toBe(['Mod report, today (Oct 7)', 'pipefail: 1 session, 20 tool calls, 0.1 ms per call (max 1 ms)', '  rewritten 2', 'Needs attention', '  nothing to flag'].join('\n'))
})

test('/mods without any diary says so', async ($, on) => {
  const s: Scene = { files: {} }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'mods', args: '' })
  expect(r.text).toBe('Mod report, last 7 days (Oct 1 to Oct 7)\nNo mod diaries in this window.')
})

const PANE = {
  plugin: 'mod-report',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'mods',
  props: { title: 'Mods', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('/mods opens the Mods pane with the same rows, the flags in the warning color', async ($, on) => {
  const opened: string[] = []
  const s: Scene = { files: FILES, surfaces: ['terminal'], opened }
  prepare(on, s)
  await $.session.start(start)
  await $.command.run({ command: 'mods', args: '' })
  expect(opened).toEqual(['mods'])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'Mod report, last 7 days (Oct 1 to Oct 7)' })).toMatchObject({ props: { bold: true } })
  expect(await ui.find({ type: 'Text', text: '  secret-guard: 35 ms per tool call, above 20 ms' })).toMatchObject({ props: { color: 'warning' } })
  expect(await ui.find({ type: 'Text', text: '  rewritten 2' })).toMatchObject({ props: { dimColor: true } })
  expect(await ui.find({ type: 'Text', text: '/mods N for another window · esc closes' })).toMatchObject({ props: { dimColor: true } })
})

test('a mod without a tool.call hook reports its sessions without a per-call cost, after the guards', async ($, on) => {
  const files = {
    'global-memory': { '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 0, { 'section-rewritten': 1 }, 0, 0) },
    pipefail: { '2026-10-07-aaaa1111.jsonl': summary('aaaa1111', 20, { rewritten: 2 }, 2, 1) },
  }
  const s: Scene = { files }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'mods', args: '1' })
  expect(r.text).toBe(
    ['Mod report, today (Oct 7)', 'pipefail: 1 session, 20 tool calls, 0.1 ms per call (max 1 ms)', '  rewritten 2', 'global-memory: 1 session', '  section-rewritten 1', 'Needs attention', '  nothing to flag'].join('\n'),
  )
})

test('/mods without a surface that draws answers with text only', async ($, on) => {
  const opened: string[] = []
  const s: Scene = { files: FILES, opened }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'mods', args: '' })
  expect(r.text).toContain('Needs attention')
  expect(opened).toEqual([])
})
