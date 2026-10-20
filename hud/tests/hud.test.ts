import { expect, mock, test } from 'claude-code/testing'
import {
  activityRows,
  heat,
  parsePr,
  ansiRow,
  compactWindowOf,
  sgrColor,
  styleOf,
  type Activity,
  bytes,
  contextTone,
  countToday,
  lineRow,
  limitTone,
  localDay,
  macMemory,
  memory,
  memoryTone,
  windowsMemory,
  modelName,
  notableOf,
  options,
  panelRows,
  paneSections,
  paneText,
  parseGit,
  parseLive,
  resetIn,
  statusSession,
  statusSnapshot,
  rowText,
  type Snapshot,
  toolDetail,
  toolName,
  width,
} from '../hooks/rules.ts'
import { statusRows } from '../hooks/styles.ts'

// A row draws as one Text with a Text per segment, and `find` matches text by inclusion, so the
// row itself matches first. The segment is the innermost Text whose whole text is `text`.
async function segment(ui: { findAll: (q: { type: string; text: string }) => Promise<unknown[]> }, text: string): Promise<unknown> {
  return (await ui.findAll({ type: 'Text', text })).filter((x) => (x as { text?: string }).text === text).at(-1)
}

const GiB = 1024 ** 3
const MiB = 1024 ** 2
// 17:00 in São Paulo.
const NOW = Date.parse('2026-10-07T20:00:00Z')
const TZ = 'America/Sao_Paulo'
// The expected times are written in one fixed zone, so the tests pass on any machine.
const SAO_PAULO = { options: { timeZone: TZ } }
const FIVE_RESET = '2026-10-07T22:30:00.000Z'
const SEVEN_RESET = '2026-10-11T16:00:00.000Z'

const WINDOWS = [
  { kind: 'five_hour', percentUsed: 61, resetsAt: FIVE_RESET },
  { kind: 'seven_day', percentUsed: 44, resetsAt: SEVEN_RESET },
]

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW,
    timeZone: TZ,
    model: 'Opus 5.5',
    project: 'my-app',
    git: { branch: 'main', isDirty: true },
    startedAt: NOW - 38 * 60_000,
    calls: 214,
    context: 42,
    windows: WINDOWS,
    memory: { headroom: 1.95 * GiB, session: 1.5 * GiB, bound: { name: 'slice', used: 3 * GiB, limit: 5 * GiB }, machine: null },
    ...over,
  }
}

// ---------------------------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------------------------

test('model ids map to display names, and unknown ones pass through', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(modelName('my-gateway-model')).toBe('my-gateway-model')
})

test('reset times read as the time left: minutes, hours and minutes, days and hours', () => {
  expect(resetIn(FIVE_RESET, NOW)).toBe('2h30m')
  expect(resetIn(SEVEN_RESET, NOW)).toBe('3d20h')
  expect(resetIn('2026-10-07T20:45:00Z', NOW)).toBe('45m')
  expect(resetIn('2026-10-07T19:00:00Z', NOW)).toBe('0m')
  expect(resetIn('not a date', NOW)).toBeNull()
})

test('color thresholds: ctx 60/85, limits 75/90, memory 1 GB/500 MB', () => {
  expect([59, 60, 84, 85].map(contextTone)).toEqual(['success', 'warning', 'warning', 'error'])
  expect([74, 75, 89, 90].map(limitTone)).toEqual(['success', 'warning', 'warning', 'error'])
  expect([499 * MiB, 999 * MiB, 1.5 * GiB].map(memoryTone)).toEqual(['error', 'warning', 'success'])
})

test('the line layout matches the approved design, and drops fields from the right when narrow', () => {
  expect(rowText(lineRow(snap(), 120))).toBe('Opus 5.5 │ my-app  main● │ ctx 42% │ 5h 61% │ 7d 44% │ mem 1.9G')
  const at50 = rowText(lineRow(snap(), 50))
  expect(at50).toBe('Opus 5.5 │ my-app  main● │ ctx 42% │ 5h 61%')
  for (const columns of [30, 50, 80, 120]) expect(width(lineRow(snap(), columns)) <= columns).toBe(true)
})

test('the panel at 120 columns: both rows as designed, right side flush with the last column', () => {
  const rows = panelRows(snap(), 120)
  expect(rows.length).toBe(2)
  const [first = [], second = []] = rows
  expect(rowText(first)).toMatch(/^Opus 5\.5 · my-app {2}main● +38m · 214 calls$/)
  expect(width(first)).toBe(120)
  expect(rowText(second)).toBe('ctx ●●●●○○○○○○  42%   5h ●●●●●●○○○○  61% resets 2h30m   7d ●●●●○○○○○○  44%   mem 1.9G free')
})

test('the panel degrades at 80 and 50 columns without passing the width or cutting an element', () => {
  for (const columns of [50, 80, 120]) for (const r of panelRows(snap(), columns)) expect(width(r) <= columns).toBe(true)
  const at80 = rowText(panelRows(snap(), 80)[1] ?? [])
  expect(at80).toContain('mem 1.9G')
  expect(at80).toContain('resets 2h30m')
  expect(at80).toMatch(/7d ●+○+ +44%/)
  const at50 = rowText(panelRows(snap(), 50)[1] ?? [])
  expect(at50).not.toContain('mem')
  // At 50 columns the 7d bar goes first, then 5h's: percents stay whole.
  expect(at50).toContain('7d 44%')
  expect(at50).toContain('61%')
  expect(rowText(panelRows(snap(), 50)[0] ?? [])).toContain('Opus 5.5')
})

test('fields without a reading hide: no context, no limits, no memory, no git', () => {
  const rows = panelRows(snap({ context: null, windows: [], memory: null, git: null }), 120)
  expect(rows.length).toBe(1)
  expect(rowText(rows[0] ?? [])).toMatch(/^Opus 5\.5 · my-app +38m · 214 calls$/)
  expect(rowText(lineRow(snap({ context: null, windows: [], memory: null, git: null }), 120))).toBe('Opus 5.5 │ my-app')
})

const ACTIVITY: Activity = {
  now: NOW,
  turnStartedAt: NOW - 252_000,
  tool: { name: 'Bash', detail: 'yarn turbo run test', startedAt: NOW - 42_000 },
  agents: [
    { type: 'Explore', description: 'map the routes', startedAt: NOW - 70_000 },
    { type: 'general-purpose', description: 'research evals', startedAt: NOW - 182_000 },
  ],
  calls: 37,
  errors: 2,
  notable: 'loop-breaker: repeated error',
}

test('the activity row shows only what Claude Code does not: the latest mod note', () => {
  expect(activityRows(ACTIVITY, 80).map(rowText)).toEqual(['loop-breaker: repeated error'])
  expect(activityRows({ ...ACTIVITY, errors: 3, notable: null }, 80)).toEqual([])
  for (const columns of [20, 50, 80]) for (const r of activityRows(ACTIVITY, columns)) expect(width(r) <= columns).toBe(true)
})

test('tool names and inputs shorten for the activity row', () => {
  expect(toolName('mcp__claude_ai_Slack__slack_send_message')).toBe('Slack slack_send_message')
  expect(toolDetail({ tool: 'Read', file_path: '/work/src/a.ts' }, '/work')).toBe('src/a.ts')
  expect(toolDetail({ tool: 'Bash', command: 'yarn\n  test', description: 'Run tests' }, '/work')).toBe('yarn test')
  expect(toolDetail({ tool: 'Grep', pattern: 'TODO' }, '/work')).toBe('TODO')
})

test('notes from other mods become a short notable', () => {
  expect(notableOf({ context: ['Loop check from the loop-breaker mod: the same error came back 3 times in this turn.'] })).toBe('loop-breaker: repeated error')
  expect(notableOf({ context: ['Loop check from the loop-breaker mod: you have edited a.ts 3 times after failed commands'] })).toBe('loop-breaker: fix attempts')
  expect(notableOf({ context: ['The memory-guard mod ran the command with a single process, because ...'] })).toBe('memory-guard: ran with 1 process')
  expect(notableOf({ context: ['unrelated'] })).toBeNull()
})

test('git status, cgroup memory and diaries parse into what the rows show', () => {
  expect(parseGit('# branch.oid abc\n# branch.head main\n1 .M N... 100644 100644 100644 a b src/x.ts\n')).toMatchObject({ branch: 'main', isDirty: true, modified: 1, staged: 0 })
  expect(parseGit('# branch.oid 0123456789\n# branch.head (detached)\n')).toMatchObject({ branch: '0123456', isDirty: false })
  expect(parseGit('')).toBeNull()

  const m = memory(
    [
      { group: '/agents.slice/demo.service', used: 1.5 * GiB, high: 3 * GiB, max: 3.5 * GiB },
      { group: '/agents.slice', used: 3 * GiB, high: 4.5 * GiB, max: 5 * GiB },
    ],
    null,
    2,
  )
  expect(m?.bound).toEqual({ name: 'slice', used: 3 * GiB, limit: 5 * GiB })
  expect(bytes(m?.headroom ?? 0)).toBe('1.9G')
  expect(memory([], { available: 4 * GiB, total: 8 * GiB }, 2)?.machine).toEqual({ available: 4 * GiB, total: 8 * GiB })
  expect(memory([], null, 2)).toBeNull()

  const at = '2026-10-07T15:00:00.000Z'
  const files = [
    { mod: 'skill-loader', name: '2026-10-07-aaaa.jsonl', text: `{"at":"${at}","event":"loaded"}\n{"at":"${at}","event":"loaded"}\n` },
    { mod: 'loop-breaker', name: '2026-10-07-aaaa.jsonl', text: `{"at":"${at}","event":"nudge"}\n{"at":"2026-10-05T15:00:00Z","event":"nudge"}\n` },
    { mod: 'usage-limit', name: '2026-10-07-aaaa.jsonl', text: `{"at":"${at}","event":"tool-refused"}\nnot json\n` },
  ]
  expect(countToday(files, '2026-10-07', TZ)).toEqual({ skills: 2, nudges: 1, refusals: 1 })
})

test('the pane text lists every section with the labels aligned', () => {
  const text = paneText(
    paneSections({
      snapshot: snap(),
      activity: ACTIVITY,
      today: { skills: 2, nudges: 1, refusals: 0 },
    }),
  )
  expect(text.split('\n')).toEqual([
    'SESSION   Opus 5.5 · my-app  main● · 38m · 214 calls · ctx 42%',
    'LIMITS    5h 61% resets 2h30m · 7d 44% resets 3d20h',
    'MEMORY    session 1.5G · slice 3.0/5.0G · 1.9G fits',
    'NOW       Bash yarn turbo run test 0:42 · 2 subagents',
    'TODAY     2 skills · 1 loop nudge · 0 refusals',
  ])
})

// ---------------------------------------------------------------------------------------------
// The mod, through the test kit
// ---------------------------------------------------------------------------------------------

type On = Parameters<Parameters<typeof test>[1]>[1]

type Setup = { surfaces?: string[]; opened?: string[]; agents?: number; text?: string[]; counts?: { git: number; agents: number }; ran?: string[][]; noRm?: boolean; env?: Record<string, string>; files?: Record<string, string>; outputs?: Record<string, string> }

const FILES: Record<string, string> = {
  '/proc/self/cgroup': '0::/agents.slice/demo.service\n',
  '/sys/fs/cgroup/agents.slice/demo.service/memory.current': String(Math.round(1.6 * GiB)),
  '/sys/fs/cgroup/agents.slice/demo.service/memory.stat': `anon 1\ninactive_file ${Math.round(0.1 * GiB)}\n`,
  '/sys/fs/cgroup/agents.slice/demo.service/memory.high': String(3 * GiB),
  '/sys/fs/cgroup/agents.slice/demo.service/memory.max': String(Math.round(3.5 * GiB)),
  '/sys/fs/cgroup/agents.slice/memory.current': String(Math.round(3.1 * GiB)),
  '/sys/fs/cgroup/agents.slice/memory.stat': `inactive_file ${Math.round(0.1 * GiB)}\n`,
  '/sys/fs/cgroup/agents.slice/memory.high': String(Math.round(4.5 * GiB)),
  '/sys/fs/cgroup/agents.slice/memory.max': String(5 * GiB),
  '/home/.local/state/mods/skill-loader/2026-10-07-aaaa.jsonl': '{"at":"2026-10-07T15:00:00Z","event":"loaded"}\n',
}

const DIRS: Record<string, { name: string; kind: 'file'; size: number; isLink: boolean }[]> = {
  '/home/.local/state/mods/skill-loader': [{ name: '2026-10-07-aaaa.jsonl', kind: 'file', size: 48, isLink: false }],
}

function setup(on: On, s: Setup = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, s.env ?? { HOME: '/home' })
  mock.store(on, {})
  const files = s.files ?? FILES
  on('session.start', () => ({ cwd: '/home/my-app' }))
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { context: { tokens: 84000, window: 200000, percent: 42 }, rateLimits: WINDOWS } }))
  on('session.surfaces', () => ({ value: s.surfaces ?? ['terminal'] }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    s.ran?.push([...e.argv])
    if (s.noRm === true && e.argv[0] === 'rm') return { deny: 'ENOENT: rm' }
    const out = s.outputs?.[e.argv[0] ?? '']
    if (out !== undefined) return { value: { exitCode: 0, stdout: out, stderr: '' } }
    if (s.outputs !== undefined && ['sysctl', 'vm_stat', 'powershell'].includes(e.argv[0] ?? '')) return { deny: 'ENOENT: command not found' }
    if (s.counts !== undefined && e.argv.includes('status')) s.counts.git += 1
    return { value: { exitCode: 0, stdout: e.argv.includes('status') ? '# branch.oid abc\n# branch.head main\n? new.ts\n' : '', stderr: '' } }
  })
  on('fs.read', ($, e) => (e.path in files ? { value: files[e.path] ?? '' } : { deny: 'no such file' }))
  on('fs.list', ($, e) => (e.path in DIRS ? { value: DIRS[e.path] ?? [] } : { deny: 'no such folder' }))
  on('fs.write', ($, e) => {
    s.text?.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => {
    if (s.counts !== undefined) s.counts.agents += 1
    return {
    value: [
      { id: 'a1', description: 'map the routes', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'research evals', type: 'general-purpose', status: (s.agents ?? 2) > 1 ? 'running' : 'completed' },
      { id: 'a3', description: 'done long ago', type: 'Explore', status: 'completed' },
    ].slice(0, s.agents === 0 ? 0 : 3),
    }
  })
  on('ui.open', ($, e) => {
    s.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('ui.render', () => OTHER_MODS)
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash' && e.command === 'yarn turbo run test') {
      await clock.sleep(60_000)
      return { result: 'ok' }
    }
    if (e.tool === 'Bash' && e.command === 'false') return { result: 'boom', isError: true, text: 'boom' }
    if (e.tool === 'Bash' && e.command === 'loop') return { result: 'ok', context: ['Loop check from the loop-breaker mod: the same error came back 3 times in this turn.'] }
    return { result: 'ok' }
  })
  return clock
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/home/my-app' } as const
const OTHER_MODS = { type: 'Text', props: {}, children: ['drawn by another mod'] }

function band(bodyColumns: number, isWorking: boolean) {
  return {
    plugin: 'hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  } as const
}

const PANE = {
  plugin: 'hud',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'hud',
  props: { title: 'HUD', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('idle panel band: identity, meters colored by threshold, other mods kept, no activity block', SAO_PAULO, async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await $.ui.mount(band(120, false))
  expect(await segment(ui, 'Opus 5.5')).toMatchObject({ props: { bold: true } })
  expect(await ui.find({ type: 'Text', text: 'my-app' })).toBeDefined()
  expect(await segment(ui, 'main')).toMatchObject({ props: { dimColor: true } })
  expect(await segment(ui, '●')).toMatchObject({ props: { color: 'warning' } })
  expect(await ui.find({ type: 'Text', text: '0m' })).toBeDefined()
  expect(await segment(ui, ' 42%')).toMatchObject({ props: { color: 'success' } })
  expect(await ui.find({ type: 'Text', text: ' resets 2h30m' })).toBeDefined()
  // 61% of 10 cells is 6 filled.
  expect(await segment(ui, '●●●●●●')).toMatchObject({ props: { color: 'success' } })
  // The tightest group is the slice: 5 GiB × 0.98 − 3 GiB used = 1.9 GiB.
  expect(await segment(ui, '1.9G')).toMatchObject({ props: { color: 'success' } })
  expect(await ui.find({ type: 'Text', text: 'drawn by another mod' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /turn / })).toBeUndefined()
})

test('a measure past the thresholds turns ctx red and 5h yellow', async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await $.ui.mount(band(120, false))
  await $.session.measure({ context: { tokens: 180000, window: 200000, percent: 90 }, rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: FIVE_RESET }], changed: ['context', 'rateLimits'] })
  expect(await segment(ui, ' 90%')).toMatchObject({ props: { color: 'error' } })
  expect(await segment(ui, ' 80%')).toMatchObject({ props: { color: 'warning' } })
})

test('disabled, the band draws nothing of the hud', { options: { enabled: false } }, async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await $.ui.mount(band(120, false))
  expect(await ui.find({ type: 'Text', text: 'my-app' })).toBeUndefined()
})

const LINE_MODE = { options: { band: 'line' }, timeoutMs: 5000 }

test('line band draws one row with separators', LINE_MODE, async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await $.ui.mount(band(120, false))
  expect(await ui.find({ type: 'Text', text: ' │ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▰/ })).toBeUndefined()
})

const OFF_MODE = { options: { band: 'off' }, timeoutMs: 5000 }

test('band off leaves the band to the other mods', OFF_MODE, async ($, on) => {
  setup(on)
  await $.session.start(START)
  const ui = await $.ui.mount(band(120, false))
  expect(await ui.drawn()).toMatchObject(OTHER_MODS)
})

test('during a turn the band adds mod notes, never errors, the tool, the subagents or the time', async ($, on) => {
  const clock = setup(on)
  await $.session.start(START)
  await $.turn.start({ text: 'run the tests', turnId: 't1' })
  const quiet = await $.ui.mount(band(100, true))
  expect(await quiet.find({ type: 'Text', text: /loop-breaker/ })).toBeUndefined()
  await quiet.unmount()
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Bash', command: 'loop' })
  const running = $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  await clock.advance(42_000)
  const ui = await $.ui.mount(band(100, true))
  expect(await ui.find({ type: 'Text', text: 'yarn turbo run test' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Explore' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /turn / })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '1 error' })).toBeUndefined()
  expect(await segment(ui, 'loop-breaker: repeated error')).toMatchObject({ props: { color: 'warning' } })
  await ui.unmount()
  await clock.advance(20_000)
  await running
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 62_000, isAborted: false, usage: null })
  const idle = await $.ui.mount(band(100, false))
  expect(await idle.find({ type: 'Text', text: 'loop-breaker: repeated error' })).toBeUndefined()
  expect(await idle.find({ type: 'Text', text: '3 calls' })).toBeDefined()
})

test('timers are bounded: a 1 s tick only during a turn, and a 15 s light refresh when idle', async ($, on) => {
  const counts = { git: 0, agents: 0 }
  const clock = setup(on, { counts })
  await $.session.start(START)
  const atStart = counts.git
  await clock.advance(10_000)
  expect(counts).toEqual({ git: atStart, agents: 0 })
  await clock.advance(5_000)
  expect(counts.git).toBe(atStart + 1)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(3_000)
  expect(counts.agents).toBe(3)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 3_000, isAborted: false, usage: null })
  await clock.advance(30_000)
  expect(counts.agents).toBe(3)
  expect(counts.git).toBe(atStart + 3)
})

test('narrow bands stay inside the columns: 50, 80 and 120', async ($, on) => {
  setup(on)
  await $.session.start(START)
  for (const columns of [50, 80, 120]) {
    const ui = await $.ui.mount(band(columns, false))
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1.9G' }) === undefined).toBe(columns === 50)
    await ui.unmount()
  }
})

test('/hud opens the pane with every section, and r refreshes it', async ($, on) => {
  const opened: string[] = []
  setup(on, { opened })
  await $.session.start(START)
  const answer = await $.command.run({ command: 'hud', args: '' })
  expect(answer).toEqual({})
  expect(opened).toEqual(['hud'])
  const ui = await $.ui.mount(PANE)
  // Each label sits in a box of LABEL_WIDTH columns, so a wrapped row keeps its indent.
  for (const label of ['SESSION', 'LIMITS', 'MEMORY', 'NOW', 'TODAY']) {
    expect(await segment(ui, label)).toMatchObject({ props: { dimColor: true } })
  }
  expect(await ui.findAll({ type: 'Box', text: 'SESSION' })).toContainEqual(expect.objectContaining({ props: expect.objectContaining({ width: 10, flexShrink: 0 }) }))
  expect(await ui.find({ type: 'Text', text: '1 skill' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'idle' })).toBeDefined()
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: 'Esc close' })).toBeDefined()
})

test('/hud in Remote Control answers with the same content as text', SAO_PAULO, async ($, on) => {
  const opened: string[] = []
  setup(on, { surfaces: [], opened })
  await $.session.start(START)
  const answer = await $.command.run({ command: 'hud', args: '' })
  expect(opened).toEqual([])
  const text = 'text' in answer && typeof answer.text === 'string' ? answer.text : ''
  expect(text.split('\n')).toEqual([
    'SESSION   Opus 5.5 · my-app  main● · 0m · 0 calls · ctx 42%',
    'LIMITS    5h 61% resets 2h30m · 7d 44% resets 3d20h',
    'MEMORY    session 1.5G · slice 3.0/5.0G · 1.9G fits',
    'NOW       idle',
    'TODAY     1 skill · 0 loop nudges · 0 refusals',
  ])
})

// Sample outputs, copied in shape from a Mac and a Windows PC. The real commands never ran in these
// tests: the macOS and Windows paths are checked only against this simulated output.
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               65536.
Pages active:                            401234.
Pages inactive:                          196608.
Pages speculative:                            0.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                              0.
"Translation faults":                 123456789.
`
const PS_JSON = '{\r\n    "TotalVisibleMemorySize":  16777216,\r\n    "FreePhysicalMemory":  4194304\r\n}\r\n'
const NO_LINUX = { '/home/.local/state/mods/skill-loader/2026-10-07-aaaa.jsonl': FILES['/home/.local/state/mods/skill-loader/2026-10-07-aaaa.jsonl'] ?? '' }

test('the macOS and Windows readings parse into the machine', () => {
  // 262144 pages of 16 KiB are 4 GiB available.
  expect(macMemory('17179869184\n', VM_STAT)).toEqual({ total: 16 * GiB, available: 4 * GiB })
  expect(macMemory('', VM_STAT)).toBeNull()
  expect(macMemory('17179869184', 'vm_stat: command not found')).toBeNull()
  expect(windowsMemory(PS_JSON)).toEqual({ total: 16 * GiB, available: 4 * GiB })
  expect(windowsMemory('Get-CimInstance : Access denied')).toBeNull()
})

test('/hud on macOS shows the machine memory read through sysctl and vm_stat', SAO_PAULO, async ($, on) => {
  setup(on, { surfaces: [], env: { HOME: '/home' }, files: NO_LINUX, outputs: { sysctl: '17179869184\n', vm_stat: VM_STAT } })
  await $.session.start(START)
  const answer = await $.command.run({ command: 'hud', args: '' })
  const text = 'text' in answer && typeof answer.text === 'string' ? answer.text : ''
  // 4 GiB available of 16, less the 2% margin of 0.32 GiB, is 3.68 GiB, shown rounded down.
  expect(text.split('\n')).toContain('MEMORY    machine 12.0/16.0G · 3.6G fits')
})

test('/hud on Windows shows the machine memory read through PowerShell, once per 15 seconds', SAO_PAULO, async ($, on) => {
  const ran: string[][] = []
  const clock = setup(on, { surfaces: [], ran, env: { USERPROFILE: '/home', OS: 'Windows_NT' }, files: NO_LINUX, outputs: { powershell: PS_JSON } })
  await $.session.start(START)
  const answer = await $.command.run({ command: 'hud', args: '' })
  const text = 'text' in answer && typeof answer.text === 'string' ? answer.text : ''
  expect(text.split('\n')).toContain('MEMORY    machine 12.0/16.0G · 3.6G fits')
  const before = ran.filter((a) => a[0] === 'powershell').length
  expect(before).toBeGreaterThan(0)
  await $.command.run({ command: 'hud', args: '' })
  expect(ran.filter((a) => a[0] === 'powershell').length).toBe(before)
  expect(ran.some((a) => a[0] === 'sysctl')).toBe(false)
  await clock.advance(16_000)
  await $.command.run({ command: 'hud', args: '' })
  expect(ran.filter((a) => a[0] === 'powershell').length).toBeGreaterThan(before)
})

test('without a memory reading, the MEMORY row is left out', SAO_PAULO, async ($, on) => {
  setup(on, { surfaces: [], env: { HOME: '/home' }, files: NO_LINUX, outputs: {} })
  await $.session.start(START)
  const answer = await $.command.run({ command: 'hud', args: '' })
  const text = 'text' in answer && typeof answer.text === 'string' ? answer.text : ''
  expect(text.includes('MEMORY')).toBe(false)
})

test('the session ends with one summary line in the diary', async ($, on) => {
  const text: string[] = []
  setup(on, { text })
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const last: unknown = JSON.parse(text.at(-1)?.trim().split('\n').at(-1) ?? '{}')
  expect(last).toMatchObject({ event: 'session-summary', session: 'abcdef12', toolCalls: 1 })
})

test('an empty or unknown time zone falls back to the system time zone', () => {
  expect(options({}).timeZone).toBe('')
  expect(options({ timeZone: 'Nowhere/Invented' }).timeZone).toBe('')
  const at = Date.parse('2026-10-11T16:00:00Z')
  const local = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
  expect(localDay(at, '')).toBe(local)
  expect(localDay(at, 'America/New_York')).toBe('2026-10-11')
})

// ---------------------------------------------------------------------------------------------
// The status line
// ---------------------------------------------------------------------------------------------

const STATUS = {
  session_id: 'abc-123',
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5 (1M context)' },
  workspace: { current_dir: '/home/me/my-app' },
  context_window: { used_percentage: 42, context_window_size: 1_000_000 },
  rate_limits: { five_hour: { used_percentage: 61, resets_at: Date.parse(FIVE_RESET) / 1000 }, seven_day: { used_percentage: 44, resets_at: Date.parse(SEVEN_RESET) / 1000 } },
  cost: { total_duration_ms: 10 * 60_000 },
}
const READ = { now: NOW, timeZone: TZ, git: { branch: 'main', isDirty: true }, memory: snap().memory }

test('the status line draws the same panel from the status JSON and the live file', () => {
  const s = statusSnapshot(STATUS, { calls: 214, startedAt: NOW - 38 * 60_000 }, READ)
  expect(panelRows(s, 120).map(rowText)).toEqual(panelRows(snap(), 120).map(rowText))
})

test('without a live file the status line counts no calls and ages the session by its duration', () => {
  const s = statusSnapshot(STATUS, null, READ)
  expect(s.calls).toBe(0)
  expect(rowText(panelRows(s, 120)[0] ?? [])).toMatch(/10m · 0 calls$/)
})

test('the context comes from current_usage while used_percentage is missing, and hides without either', () => {
  const usage = { ...STATUS, context_window: { context_window_size: 200_000, current_usage: { input_tokens: 10_000, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 } } }
  expect(statusSnapshot(usage, null, READ).context).toBe(15)
  expect(statusSnapshot({ ...STATUS, context_window: { context_window_size: 200_000 } }, null, READ).context).toBeNull()
  expect(statusSnapshot(null, null, READ)).toMatchObject({ model: null, project: null, context: null, windows: [] })
})

test('the live file and the session id are checked before use', () => {
  expect(parseLive('{"calls":3,"startedAt":5}')).toEqual({ calls: 3, startedAt: 5 })
  expect(parseLive('{"calls":"3"}')).toBeNull()
  expect(parseLive('not json')).toBeNull()
  expect(statusSession(STATUS)).toBe('abc-123')
  expect(statusSession({ session_id: '../../etc/passwd' })).toBeNull()
})

test('ansi rows color tones, dim and bold, and leave plain text bare', () => {
  expect(ansiRow([{ text: 'a' }, { text: 'b', tone: 'error' }, { text: 'c', dim: true, bold: true }])).toBe('a\x1b[31mb\x1b[0m\x1b[1;2mc\x1b[0m')
})

// ---------------------------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------------------------

test('the bar option swaps the glyphs and barWidth scales the bars', () => {
  const style = styleOf(options({ bar: 'solid', barWidth: 20 }))
  const second = rowText(panelRows(snap({ style }), 200)[1] ?? [])
  expect(second).toContain('ctx ████████░░░░░░░░░░░░  42%')
  expect(rowText(panelRows(snap({ style: styleOf(options({ bar: 'nonsense', barWidth: 99 })) }), 120)[1] ?? [])).toContain('ctx ●●●●○○○○○○  42%')
})

test('hide leaves the named fields out of the panel and the line', () => {
  const style = styleOf(options({ hide: 'branch, calls mem reset 7d bogus' }))
  const [first = [], second = []] = panelRows(snap({ style }), 120)
  expect(rowText(first)).toMatch(/^Opus 5\.5 · my-app +38m$/)
  expect(rowText(second)).toBe('ctx ●●●●○○○○○○  42%   5h ●●●●●●○○○○  61%')
  expect(rowText(lineRow(snap({ style }), 120))).toBe('Opus 5.5 │ my-app │ ctx 42% │ 5h 61%')
})

test('colors take names, bright names, hex and 256-color numbers, and fall back on the rest', () => {
  expect(styleOf(options({ colors: 'cyan #ff8800 nope' })).colors).toEqual({ success: 'cyan', warning: '#ff8800', error: 'red' })
  expect(['green', 'bright-green', 'bright-gray', '#ff8800', '208', 'nope'].map(sgrColor)).toEqual(['32', '92', '97', '38;2;255;136;0', '38;5;208', '39'])
  expect(ansiRow([{ text: 'x', tone: 'success' }], { success: '#000000', warning: 'yellow', error: 'red' })).toBe('\x1b[38;2;0;0;0mx\x1b[0m')
})

test('the context is measured against the auto-compact window when it is smaller than the model window', () => {
  // 15% of 1M is 150k tokens: 37.5% of a 400k compaction window.
  const input = { ...STATUS, context_window: { used_percentage: 15, context_window_size: 1_000_000 } }
  expect(statusSnapshot(input, null, { ...READ, compactWindow: 400_000 }).context).toBe(37.5)
  expect(statusSnapshot(input, null, { ...READ, compactWindow: null }).context).toBe(15)
  expect(statusSnapshot(input, null, { ...READ, compactWindow: 2_000_000 }).context).toBe(15)
  expect(compactWindowOf('500000', 300_000)).toBe(500_000)
  expect(compactWindowOf(undefined, 300_000)).toBe(300_000)
  expect(compactWindowOf('500k', 50_000)).toBe(100_000)
  expect(compactWindowOf(undefined, undefined)).toBeNull()
})

// ---------------------------------------------------------------------------------------------
// The status line styles
// ---------------------------------------------------------------------------------------------

const GIT_STATUS = [
  '# branch.oid abc',
  '# branch.head feat/hud-git',
  '# branch.upstream origin/feat/hud-git',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 a b staged.ts',
  '1 .M N... 100644 100644 100644 a b one.ts',
  '1 MM N... 100644 100644 100644 a b both.ts',
  'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
  '? new.ts',
].join('\n')

test('git status counts ahead, behind, staged, modified and untracked', () => {
  expect(parseGit(GIT_STATUS)).toEqual({ branch: 'feat/hud-git', isDirty: true, ahead: 2, behind: 1, staged: 2, modified: 3, untracked: 1 })
})

test('the PR shows only when open, with its checks rolled up', () => {
  const pr = (rollup: unknown[], state = 'OPEN') => parsePr(JSON.stringify({ number: 252, state, statusCheckRollup: rollup }))
  expect(pr([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])).toEqual({ number: 252, checks: 'ok' })
  expect(pr([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }])).toEqual({ number: 252, checks: 'fail' })
  expect(pr([{ status: 'IN_PROGRESS', conclusion: '' }])).toEqual({ number: 252, checks: 'pending' })
  expect(pr([{ state: 'PENDING' }])).toEqual({ number: 252, checks: 'pending' })
  expect(pr([])).toEqual({ number: 252, checks: 'none' })
  expect(pr([], 'MERGED')).toBeNull()
  expect(parsePr('{}')).toBeNull()
  expect(parsePr('not json')).toBeNull()
})

const RICH = snap({ git: { branch: 'feat/hud-git', isDirty: true, ahead: 2, behind: 0, staged: 1, modified: 3, untracked: 0 }, pr: { number: 252, checks: 'ok' } })

test('every style fits 100, 80 and 60 columns in every git state', () => {
  const states = [RICH, snap({ git: { branch: 'dev', isDirty: false, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0 }, pr: null }), snap({ git: null, project: 'acme' })]
  for (const style of ['refined', 'blocks', 'minimal', 'compact'] as const)
    for (const icons of ['nerd', 'unicode'] as const)
      for (const s of states) for (const columns of [100, 80, 60]) for (const r of statusRows(s, style, icons, columns)) expect(width(r) <= columns).toBe(true)
})

test('refined: identity and git on top, meters below, as designed', () => {
  const [top = [], bottom = []] = statusRows(RICH, 'refined', 'unicode', 100).map(rowText)
  expect(top).toMatch(/^Opus 5\.5 {3}my-app {3}feat\/hud-git {2}↑ 2 {2}\+ 1 {2}● 3 {3}PR #252 ✓ +38m {2}· {2}214 calls$/)
  expect(bottom).toBe('ctx ●●●●○○○○○○ 42%   5h ●●●●●●○○○○ 61%  resets 2h30m   7d ●●●●○○○○○○ 44%   mem 1.9G free')
})

test('refined in a narrow terminal drops the calls first and keeps the git counts', () => {
  const [top = ''] = statusRows(RICH, 'refined', 'unicode', 72).map(rowText)
  expect(top).not.toContain('calls')
  expect(top).toContain('↑ 2  + 1  ● 3')
})

test('a clean branch reads synced, and outside a repo there is no git', () => {
  const clean = snap({ git: { branch: 'dev', isDirty: false, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0 } })
  expect(rowText(statusRows(clean, 'refined', 'unicode', 100)[0] ?? [])).toContain('dev  ✓ synced')
  expect(rowText(statusRows(clean, 'minimal', 'unicode', 100)[0] ?? [])).toContain('dev  in sync')
  expect(rowText(statusRows(snap({ git: null }), 'minimal', 'unicode', 100)[0] ?? [])).toContain('not a git repo')
})

test('compact is one line when it fits and two when it does not', () => {
  const small = snap({ git: null, project: 'x', memory: null })
  expect(statusRows(small, 'compact', 'unicode', 100)).toHaveLength(1)
  expect(statusRows(RICH, 'compact', 'unicode', 80)).toHaveLength(2)
})

test('blocks paint their background, and the nerd set uses Nerd Font glyphs', () => {
  const [top = []] = statusRows(RICH, 'blocks', 'nerd', 100)
  expect(top.some((s) => s.chip === 'strong')).toBe(true)
  expect(top.some((s) => s.chip === 'soft')).toBe(true)
  expect(rowText(top)).toContain('\u{F418} feat/hud-git')
  expect(ansiRow([{ text: 'x', chip: 'soft', hue: 'branch' }])).toBe('\x1b[35;48;5;236mx\x1b[0m')
})

test('the style and icons options fall back to refined and nerd', () => {
  expect(options({ style: 'BLOCKS', icons: 'Unicode' })).toMatchObject({ style: 'blocks', icons: 'unicode' })
  expect(options({ style: 'fancy', icons: 'emoji' })).toMatchObject({ style: 'refined', icons: 'nerd' })
})

test('the bars color by heat: each cell by its place in gradient, the whole bar by its percent in solid', () => {
  const cells = (colors: 'gradient' | 'solid' | 'tone') => (statusRows(snap({ context: 50 }), 'refined', 'unicode', 120, colors)[1] ?? []).filter((x) => x.text === '●' || /^●+$/.test(x.text))
  const g = cells('gradient')
  expect(g[0]?.rgb).toEqual(heat(0))
  expect(g[1]?.rgb).toEqual(heat(1 / 9))
  expect(cells('solid')[0]).toMatchObject({ text: '●●●●●', rgb: heat(0.5) })
  expect(cells('tone')[0]).toMatchObject({ text: '●●●●●', tone: 'success' })
  expect(heat(0)).toEqual([0, 200, 80])
  expect(heat(0.5)).toEqual([255, 200, 80])
  expect(heat(1)).toEqual([255, 0, 80])
  expect(ansiRow([{ text: 'x', rgb: [1, 2, 3] }])).toBe('\x1b[38;2;1;2;3mx\x1b[0m')
  expect(options({ barColor: 'SOLID' }).barColor).toBe('solid')
  expect(options({}).barColor).toBe('gradient')
})

test('the start sweeps live files older than two days without find, and falls back to del without rm', async ($, on) => {
  const live = '/home/.local/state/mods/hud/live'
  DIRS[live] = [
    { name: 'old.json', kind: 'file', size: 30, isLink: false, mtimeMs: NOW - 3 * 86_400_000 } as never,
    { name: 'fresh.json', kind: 'file', size: 30, isLink: false, mtimeMs: NOW - 3_600_000 } as never,
  ]
  try {
    const ran: string[][] = []
    setup(on, { ran, noRm: true })
    await $.session.start(START)
    const removals = ran.filter((a) => a[0] === 'rm' || a[0] === 'cmd')
    expect(ran.some((a) => a[0] === 'find')).toBe(false)
    expect(removals).toEqual([
      ['rm', '-f', `${live}/old.json`],
      ['cmd', '/d', '/c', 'del', '/f', '/q', '\\home\\.local\\state\\mods\\hud\\live\\old.json'],
    ])
  } finally {
    delete DIRS[live]
  }
})
