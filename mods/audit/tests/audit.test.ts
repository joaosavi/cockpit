import { expect, mock, test } from 'claude-code/testing'
import { expired, formatTime, isWrite, line, mcpTool, options, parse, report, summarize, DEFAULTS } from '../hooks/rules.ts'

// The expected times are written in one fixed zone, so the tests pass on any machine.
const SAO_PAULO = { options: { timeZone: 'America/Sao_Paulo' } }
const O = { ...DEFAULTS, timeZone: 'America/Sao_Paulo' }

test('reads the server and the action from an MCP tool name', () => {
  expect(mcpTool('mcp__claude_ai_Slack__slack_send_message')).toEqual({ server: 'claude_ai_Slack', action: 'slack_send_message' })
  expect(mcpTool('Bash')).toBeNull()
})

test('counts as a write anything that is not clearly a read', () => {
  expect(isWrite('slack_send_message')).toBe(true)
  expect(isWrite('create_draft')).toBe(true)
  expect(isWrite('manage_crm_objects')).toBe(true)
  expect(isWrite('notion-create-pages')).toBe(true)
  expect(isWrite('trash_thread')).toBe(true)
  expect(isWrite('slack_read_channel')).toBe(false)
  expect(isWrite('get_crm_objects')).toBe(false)
  expect(isWrite('search_threads')).toBe(false)
  expect(isWrite('notion-fetch')).toBe(false)
  expect(isWrite('list_events')).toBe(false)
})

test('cuts long arguments and drops the fields the engine adds', () => {
  const s = summarize({ tool: 'x', tool_use_id: 'y', channel: 'C1', text: 'a'.repeat(1000) })
  expect(Object.keys(s)).toEqual(['channel', 'text'])
  expect(s.text?.length).toBe(301)
})

test('keeps one line under 4 KiB, so the kernel appends it in one piece', () => {
  const input = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, 'x'.repeat(300)]))
  const l = line({ at: '2026-10-07T10:00:00.000Z', session: 's', cwd: '/w', server: 'S', action: 'a', input, outcome: 'ok', ms: 1 })
  expect(l.length <= 3500).toBe(true)
})

test('finds the files past the retention by the date in their name', () => {
  expect(expired(['2026-09-01.jsonl', '2026-10-01.jsonl', 'notes.txt'], '2026-10-07', 30)).toEqual(['2026-09-01.jsonl'])
})

test('/audit lists the last entries and filters by server or action', () => {
  const text = [
    JSON.stringify({ at: '2026-10-07T13:00:00.000Z', session: 's', cwd: '/w', server: 'claude_ai_Slack', action: 'slack_send_message', input: { channel: 'C1' }, outcome: 'ok', ms: 5 }),
    'not json',
    JSON.stringify({ at: '2026-10-07T14:00:00.000Z', session: 's', cwd: '/w', server: 'claude_ai_Gmail', action: 'create_draft', input: { to: 'a@b' }, outcome: 'error', error: 'quota', ms: 9 }),
  ].join('\n')
  const entries = parse(text)
  expect(entries.length).toBe(2)
  const all = report(entries, '', O)
  expect(all).toBe('Last 2 write calls, newest first:\nOct 7, 11:00 · Gmail · create_draft · error: quota\n  to=a@b\nOct 7, 10:00 · Slack · slack_send_message · ok\n  channel=C1')
  expect(all).toContain('create_draft · error: quota')
  expect(report(entries, 'gmail', O)).not.toContain('slack_send_message')
  expect(report(entries, '1', O)).not.toContain('slack_send_message')
})

type Scene = {
  appended: string[]
  calls: string[]
  // The audit files in the folder, by name, and the surfaces and panes /audit sees and opens.
  files?: Record<string, string>
  surfaces?: string[]
  opened?: string[]
}

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene) {
  mock.clock(on, { now: Date.parse('2026-10-07T13:00:00Z') })
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('fs.list', () => ({ value: Object.keys(s.files ?? {}).map((name) => ({ name, kind: 'file' })) }))
  on('fs.read', ($, e) => {
    const name = Object.keys(s.files ?? {}).find((n) => e.path.endsWith(n))
    return name === undefined ? { deny: 'no file' } : { value: s.files?.[name] ?? '' }
  })
  on('session.surfaces', () => ({ value: s.surfaces ?? [] }))
  on('ui.open', ($, e) => {
    s.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'sh' && e.init?.stdin !== undefined) s.appended.push(e.init.stdin)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('tool.call', ($, e) => {
    s.calls.push(e.tool)
    if (e.tool.endsWith('trash_thread')) return { deny: 'blocked by a hook' }
    return { result: 'ok', text: 'ok' }
  })
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('records an MCP write and lets it run unchanged', async ($, on) => {
  const s = { appended: [], calls: [] }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'mcp__claude_ai_Slack__slack_send_message', channel_id: 'C1', message: 'oi' })
  expect(r).toMatchObject({ text: 'ok' })
  expect(s.appended.length).toBe(1)
  expect(JSON.parse(s.appended[0] ?? '{}')).toMatchObject({ event: 'write-call', session: 'abcdef12', server: 'claude_ai_Slack', action: 'slack_send_message', outcome: 'ok', input: { channel_id: 'C1', message: 'oi' } })
})

test('does not record reads or built-in tools', async ($, on) => {
  const s = { appended: [], calls: [] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__claude_ai_Slack__slack_read_channel', channel_id: 'C1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(s.appended).toEqual([])
  expect(s.calls.length).toBe(2)
})

test('records a refused write as denied, with the reason', async ($, on) => {
  const s = { appended: [], calls: [] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__trash_thread', threadId: 't1' })
  expect(JSON.parse(s.appended[0] ?? '{}')).toMatchObject({ outcome: 'denied', error: 'blocked by a hook' })
})

test('marks a subagent call with its id', async ($, on) => {
  const s = { appended: [], calls: [] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__claude_ai_Notion__notion-create-pages', agentId: 'sub1', pages: '[]' })
  expect(JSON.parse(s.appended[0] ?? '{}')).toMatchObject({ agentId: 'sub1' })
})

const PANE = {
  plugin: 'audit',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'audit',
  props: { title: 'Audit', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// 30 entries, one a minute from 12:00 UTC: Slack sends, every tenth a Gmail draft that failed, the last one denied.
function dayFile(): string {
  return Array.from({ length: 30 }, (_, i) => {
    const at = new Date(Date.parse('2026-10-07T12:00:00Z') + i * 60_000).toISOString()
    const gmail = i % 10 === 0
    const outcome = i === 29 ? 'denied' : gmail ? 'error' : 'ok'
    return JSON.stringify({
      at,
      session: 's',
      cwd: '/w',
      server: gmail ? 'claude_ai_Gmail' : 'claude_ai_Slack',
      action: gmail ? 'create_draft' : 'slack_send_message',
      input: { channel_id: `C${i}`, message: 'x'.repeat(200) },
      outcome,
      ...(outcome === 'ok' ? {} : { error: outcome === 'denied' ? 'blocked by a hook' : 'quota' }),
      ms: 5,
    })
  }).join('\n')
}

test('/audit opens the Audit pane with one row per entry, colored by outcome', SAO_PAULO, async ($, on) => {
  const opened: string[] = []
  const s = { appended: [], calls: [], files: { '2026-10-07.jsonl': dayFile() }, surfaces: ['terminal'], opened }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'audit', args: '' })
  // The text reply stays the same, for Remote Control.
  expect(r.text).toContain('Last 20 write calls, newest first:\nOct 7, 09:29 · Slack · slack_send_message · denied: blocked by a hook\n')
  expect(opened).toEqual(['audit'])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'Last 20 write calls' })).toMatchObject({ props: { bold: true } })
  expect(await ui.find({ type: 'Text', text: 'esc closes' })).toMatchObject({ props: { dimColor: true } })
  expect(await ui.find({ type: 'Text', text: 'Oct 7, 09:29 · Slack · slack_send_message · ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'denied: blocked by a hook' })).toMatchObject({ props: { color: 'warning' } })
  expect(await ui.find({ type: 'Text', text: 'error: quota' })).toMatchObject({ props: { color: 'error' } })
  expect(await ui.find({ type: 'Text', text: /^ok$/ })).toMatchObject({ props: { color: 'success' } })
  // The arguments row is cut to the 60 columns of the pane.
  const args = await ui.find({ type: 'Text', text: /^ {2}channel_id=C29, / })
  expect(args).toMatchObject({ props: { dimColor: true } })
  expect(args?.text.length).toBe(60)
})

test('More in the Audit pane shows 20 entries more, and Refresh keeps the filter', async ($, on) => {
  const s = { appended: [], calls: [], files: { '2026-10-07.jsonl': dayFile() }, surfaces: ['terminal'] }
  prepare(on, s)
  await $.session.start(start)
  await $.command.run({ command: 'audit', args: '5' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'Last 5 write calls' })).toBeDefined()
  await ui.press({ key: 'more' })
  expect(await ui.find({ type: 'Text', text: 'Last 25 write calls' })).toBeDefined()
  await ui.press({ key: 'more' })
  // Only 30 entries exist.
  expect(await ui.find({ type: 'Text', text: 'Last 30 write calls' })).toBeDefined()

  await $.command.run({ command: 'audit', args: 'gmail' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: 'Last 3 write calls matching "gmail"' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /slack_send_message/ })).toBeUndefined()
})

test('/audit without a surface that draws answers with text only', SAO_PAULO, async ($, on) => {
  const opened: string[] = []
  const s = { appended: [], calls: [], files: { '2026-10-07.jsonl': dayFile() }, opened }
  prepare(on, s)
  await $.session.start(start)
  const r = await $.command.run({ command: 'audit', args: '' })
  expect(r.text).toContain('Last 20 write calls, newest first:\nOct 7, 09:29 · Slack · slack_send_message · denied: blocked by a hook\n')
  expect(opened).toEqual([])
})

test('the session ends with one summary line in the day file, which /audit skips', async ($, on) => {
  const s = { appended: [], calls: [] }
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__claude_ai_Slack__slack_send_message', channel_id: 'C1', message: 'oi' })
  await $.tool.call({ tool: 'mcp__claude_ai_Slack__slack_read_channel', channel_id: 'C1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  expect(s.appended.length).toBe(2)
  expect(JSON.parse(s.appended[1] ?? '{}')).toEqual({
    at: '2026-10-07T13:00:00.000Z',
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work',
    toolCalls: 2,
    actions: { recorded: 1 },
    hookMs: 0,
    maxHookMs: 0,
  })
  expect(parse(s.appended.join('')).length).toBe(1)
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
