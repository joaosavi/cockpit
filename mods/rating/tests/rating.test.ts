import { expect, mock, test } from 'claude-code/testing'
import { approves, isTemporary, bandLayout, implicitScore, isRetry, mentions, CORRECTION_PHRASES, APPROVAL_PHRASES, parseRate, signalsFor } from '../hooks/rules.ts'

// Invented data only.
const NOW = Date.parse('2026-10-07T13:00:00Z')
const USAGE = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-test' }

type ToolAnswer = { result?: string; isError?: boolean; deny?: string; context?: string[] }

type Scene = {
  appends: Array<{ argv: readonly string[]; stdin: string }>
  results?: ToolAnswer[]
  files?: Record<string, string>
  surfaces?: string[]
  opened?: string[]
  // The argv of each git call.
  gits?: (readonly string[])[]
}

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene) {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.model', () => ({ value: 'claude-session-model' }))
  on('session.surfaces', () => ({ value: s.surfaces ?? [] }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    s.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.list', ($, e) => {
    const prefix = e.path.endsWith('/') ? e.path : `${e.path}/`
    const names = Object.keys(s.files ?? {})
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length))
    return { value: names.map((name) => ({ name, kind: 'file' })) }
  })
  on('fs.read', ($, e) => {
    const text = s.files?.[e.path]
    return text === undefined ? { deny: 'no file' } : { value: text }
  })
  on('process.run', ($, e) => {
    if (e.init?.stdin !== undefined) s.appends.push({ argv: e.argv, stdin: e.init.stdin })
    if (e.argv[0] === 'git') s.gits?.push(e.argv)
    const stdout = e.argv[0] === 'git' ? 'a1b2c3d\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', () => ({ cwd: '/work/acme-app' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => {
    const r = s.results?.shift() ?? { result: 'ok' }
    if (r.deny !== undefined) return { deny: r.deny }
    if (r.isError === true) return { isError: true, result: r.result, text: r.result }
    return { result: r.result ?? '', text: r.result ?? '', ...(r.context === undefined ? {} : { context: r.context }) }
  })
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work/acme-app' } as const

type Api = Parameters<Parameters<typeof test>[1]>[0]

async function turn($: Api, id: string, prompt: string, answer: string, opts: { origin?: string; aborted?: boolean; tools?: Array<Record<string, unknown> & { tool: string }> } = {}) {
  await $.prompt.submit({ text: prompt, wait: false, origin: { kind: opts.origin ?? 'composer' } })
  await $.turn.start({ text: prompt, turnId: id })
  for (const t of opts.tools ?? []) await $.tool.call(t)
  await $.turn.complete({ turnId: id, answer, durationMs: 1200, isAborted: opts.aborted === true, reason: opts.aborted === true ? 'aborted' : 'answer', usage: USAGE })
}

function lines(s: Scene, kind: string): Record<string, unknown>[] {
  return s.appends.filter((a) => (a.argv.at(-1) ?? '').includes(`/${kind}/`)).map((a) => JSON.parse(a.stdin))
}

test('a turn is recorded with prompt, tools cut to size, answer, skills and the config version', { options: { configRepo: '~/dotfiles' } }, async ($, on) => {
  const s: Scene = {
    appends: [],
    gits: [],
    results: [{ result: 'x'.repeat(5000) }, { result: 'skill text' }, { result: 'read ok', context: ['The skill typescript-best-practices comes in full below, already loaded by the skill-loader mod.\n\n...'] }],
  }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'fix the invoice total', 'Fixed the total.', {
    tools: [
      { tool: 'Bash', command: 'y'.repeat(3000) },
      { tool: 'Skill', skill: 'diagnosing-bugs' },
      { tool: 'Read', file_path: '/work/acme-app/src/a.ts' },
    ],
  })
  const [t] = lines(s, 'turns')
  expect(t).toMatchObject({
    v: 1,
    id: 'abcdef12:t1',
    session: 'abcdef123456',
    at: '2026-10-07T13:00:00.000Z',
    cwd: '/work/acme-app',
    project: 'acme-app',
    model: 'claude-test',
    origin: 'composer',
    prompt: 'fix the invoice total',
    answer: 'Fixed the total.',
    aborted: false,
    durationMs: 1200,
    configVersion: 'a1b2c3d',
    skills: ['diagnosing-bugs', 'typescript-best-practices'],
  })
  const tools = Reflect.get(t ?? {}, 'tools')
  expect(tools).toMatchObject([
    { tool: 'Bash', outcome: 'ok' },
    { tool: 'Skill', input: { skill: 'diagnosing-bugs' } },
    { tool: 'Read', input: { file_path: '/work/acme-app/src/a.ts' } },
  ])
  const bash = Array.isArray(tools) ? tools[0] : null
  expect(Reflect.get(Reflect.get(bash, 'input'), 'command').length).toBe(1001)
  expect(Reflect.get(bash, 'output').length).toBe(2001)
  expect(s.gits).toEqual([['git', '-C', '/home/u/dotfiles', 'rev-parse', '--short', 'HEAD']])
})

test('without configRepo, no git runs and the turn records configVersion null', async ($, on) => {
  const s: Scene = { appends: [], gits: [] }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'hello', 'Hi.')
  expect(lines(s, 'turns')[0]).toMatchObject({ configVersion: null })
  expect(s.gits).toEqual([])
})

test("subagent tool calls go into the parent turn with their agentId, and the subagent's turn.complete writes nothing", async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  await $.prompt.submit({ text: 'research the bug', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'research the bug', turnId: 't1' })
  await $.tool.call({ tool: 'Agent', prompt: 'look', description: 'look', subagent_type: 'Explore' })
  await $.tool.call({ tool: 'Grep', pattern: 'total', agentId: 'sub1' })
  await $.turn.complete({ turnId: 'st', agentId: 'sub1', answer: 'found', durationMs: 5, isAborted: false, reason: 'answer', usage: USAGE })
  expect(lines(s, 'turns').length).toBe(0)
  await $.turn.complete({ turnId: 't1', answer: 'Found it.', durationMs: 50, isAborted: false, reason: 'answer', usage: USAGE })
  const [t] = lines(s, 'turns')
  expect(t).toMatchObject({ tools: [{ tool: 'Agent' }, { tool: 'Grep', agentId: 'sub1' }] })
})

test('/rate 4 verbose -- too long writes the rating for the last turn', async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'summarize the quarterly report for the board meeting next week please', 'Summary...')
  const r = await $.command.run({ command: 'rate', args: '4 verbose -- too long' })
  expect(r.text).toBe('Rated 4/5: abcdef12:t1 "summarize the quarterly report for the board meeting next we…"')
  expect(lines(s, 'ratings')).toEqual([{ v: 1, turn: 'abcdef12:t1', score: 4, tags: ['verbose'], comment: 'too long', at: '2026-10-07T13:00:00.000Z', source: 'user' }])
  const shown = await $.command.run({ command: 'rate', args: '' })
  expect(shown.text).toContain('You: 4/5 · implicit: pending until your next prompt')
})

test('/rate before any turn, and an invalid /rate 9', async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  expect((await $.command.run({ command: 'rate', args: '' })).text).toContain('no finished turn')
  expect((await $.command.run({ command: 'rate', args: '9' })).text).toContain('Usage: /rate <1-5>')
  expect((await $.command.run({ command: 'rate', args: 'great' })).text).toContain('Usage: /rate <1-5>')
  expect(lines(s, 'ratings').length).toBe(0)
})

const BAND = {
  plugin: 'rating',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const OTHER_MODS = { type: 'Text', props: {}, children: ['drawn by another mod'] }

test('the band shows after a turn, keeps the other mods, and pressing rate-2 writes score 2 and hides it', async ($, on) => {
  const s: Scene = { appends: [], surfaces: ['terminal'] }
  prepare(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'rate-2' })).toBeUndefined()
  await turn($, 't1', 'rename the column', 'Renamed.')
  expect(await ui.find({ type: 'Text', text: 'Rate' })).toMatchObject({ props: { dimColor: true } })
  expect(await ui.find({ key: 'rate-5' })).toMatchObject({ props: { hotkey: '5', plain: true } })
  expect(await ui.find({ type: 'Text', text: 'drawn by another mod' })).toBeDefined()
  await ui.press({ key: 'rate-2' })
  expect(lines(s, 'ratings')).toMatchObject([{ turn: 'abcdef12:t1', score: 2, tags: [], source: 'user' }])
  expect(await ui.find({ key: 'rate-2' })).toBeUndefined()
  expect(await ui.drawn()).toMatchObject(OTHER_MODS)
})

test('the band hides when the next prompt is submitted, and never shows for an aborted turn', async ($, on) => {
  const s: Scene = { appends: [], surfaces: ['terminal'] }
  prepare(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  const ui = await $.ui.mount(BAND)
  await turn($, 't1', 'rename the column', 'Renamed.')
  expect(await ui.find({ key: 'rate-1' })).toBeDefined()
  await $.prompt.submit({ text: 'now the table', wait: false, origin: { kind: 'composer' } })
  expect(await ui.find({ key: 'rate-1' })).toBeUndefined()
  await $.turn.start({ text: 'now the table', turnId: 't2' })
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 5, isAborted: true, reason: 'aborted', usage: USAGE })
  expect(await ui.find({ key: 'rate-1' })).toBeUndefined()
})

test('the next human prompt writes signals for the previous turn: correction and retry', async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'list the overdue invoices for october', 'Here are 3.')
  await turn($, 't2', 'não era isso, list the overdue invoices for october only', 'Here are 2.')
  const [sig] = lines(s, 'signals')
  expect(sig).toEqual({
    v: 1,
    turn: 'abcdef12:t1',
    at: '2026-10-07T13:00:00.000Z',
    signals: { aborted: false, retried: true, correction: true, approval: false, loopNudges: 0, toolErrors: 0, refusals: 0 },
    // 3 - 1.5 (correction) - 1 (retry), clamped to 1
    implicitScore: 1,
    source: 'implicit',
  })
  const shown = await $.command.run({ command: 'rate', args: '' })
  expect(shown.text).toContain('abcdef12:t2')
})

test('an approval raises the implicit score, and /rate shows it', async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'draft the email to the client', 'Draft...')
  await $.prompt.submit({ text: 'Perfeito, valeu!', wait: false, origin: { kind: 'bridge' } })
  expect(lines(s, 'signals')).toMatchObject([{ turn: 'abcdef12:t1', signals: { approval: true, correction: false, retried: false }, implicitScore: 4.5 }])
  expect((await $.command.run({ command: 'rate', args: '' })).text).toContain('implicit: 4.5')
})

test('automatic-origin prompts do not count as correction or approval, and leave the turn waiting for a human', async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'check the deploy', 'Deployed.')
  await $.prompt.submit({ text: 'wrong, not what I asked', wait: false, origin: { kind: 'task-notification' } })
  expect(lines(s, 'signals').length).toBe(0)
  // The automatic prompt starts its own turn; when it completes, t1 is labeled without a next prompt.
  await $.turn.start({ text: 'wrong, not what I asked', turnId: 't2' })
  await $.turn.complete({ turnId: 't2', answer: 'Noted.', durationMs: 5, isAborted: false, reason: 'answer', usage: USAGE })
  expect(lines(s, 'signals')).toMatchObject([{ turn: 'abcdef12:t1', signals: { correction: false, approval: false, retried: false }, implicitScore: 3 }])
  expect(lines(s, 'turns')).toMatchObject([{ origin: 'composer' }, { origin: 'task-notification', prompt: 'wrong, not what I asked' }])
})

test('loop nudges, refusals and tool errors are counted, and the last turn is labeled at session end', async ($, on) => {
  const s: Scene = {
    appends: [],
    results: [
      { result: 'fail', isError: true },
      { result: 'fail', context: ['Loop check: the same error came back 3 times this turn. Stop.'] },
      { deny: 'refused by policy' },
    ],
  }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'make the tests pass', 'Still failing.', {
    tools: [
      { tool: 'Bash', command: 'yarn test' },
      { tool: 'Bash', command: 'yarn test' },
      { tool: 'Bash', command: 'rm -rf build' },
    ],
  })
  const [t] = lines(s, 'turns')
  expect(t).toMatchObject({ tools: [{ outcome: 'error' }, { outcome: 'ok', nudged: true }, { outcome: 'denied', output: 'refused by policy' }] })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  // 3 - 0.5 (one nudge) - 0.25 (one refusal)
  expect(lines(s, 'signals')).toMatchObject([{ signals: { loopNudges: 1, refusals: 1, toolErrors: 1 }, implicitScore: 2.3 }])
})

test('every append holds a flock on the file and appends with cat', async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'hello', 'Hi.')
  const file = '/home/u/datasets/agent-ratings/turns/2026-10-07.jsonl'
  expect(s.appends[0]?.argv).toEqual(['flock', `${file}.lock`, 'sh', '-c', 'cat >> "$1"', 'sh', file])
})

test('the session ends with one summary line: turns recorded, rated, signals written, tool calls, hook time', async ($, on) => {
  const s: Scene = { appends: [] }
  prepare(on, s)
  await $.session.start(start)
  await turn($, 't1', 'first task', 'Done.', { tools: [{ tool: 'Read', file_path: '/a' }] })
  await turn($, 't2', 'second task', 'Done.', { tools: [{ tool: 'Read', file_path: '/b' }] })
  await $.command.run({ command: 'rate', args: '5' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const summary = s.appends.filter((a) => (a.argv.at(-1) ?? '').includes('/.local/state/mods/rating/'))
  expect(summary.length).toBe(1)
  expect(JSON.parse(summary[0]?.stdin ?? '{}')).toEqual({
    at: '2026-10-07T13:00:00.000Z',
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work/acme-app',
    toolCalls: 2,
    actions: { 'turns-recorded': 2, 'signals-written': 2, rated: 1 },
    hookMs: 0,
    maxHookMs: 0,
  })
})

const DIR = '/home/u/datasets/agent-ratings'

function turnLine(id: string, project: string, prompt: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, id, session: 's', at: '2026-10-06T10:00:00.000Z', project, prompt, answer: 'a', tools: [], skills: [], ...extra })
}

test('/ratings aggregates per project, per skill and per signal, lists the lowest rated, and opens the pane', async ($, on) => {
  const s: Scene = {
    appends: [],
    surfaces: ['terminal'],
    opened: [],
    files: {
      [`${DIR}/turns/2026-10-06.jsonl`]: [
        turnLine('s:1', 'acme', 'fix the login bug', { skills: ['diagnosing-bugs'] }),
        turnLine('s:2', 'acme', 'write the release notes'),
        turnLine('s:3', 'billing', 'reconcile the october totals'),
        'cut line {',
      ].join('\n'),
      [`${DIR}/turns/2026-09-01.jsonl`]: turnLine('old:1', 'acme', 'outside the window'),
      [`${DIR}/ratings/2026-10-06.jsonl`]: [
        JSON.stringify({ v: 1, turn: 's:1', score: 5, tags: [], at: 'x', source: 'user' }),
        JSON.stringify({ v: 1, turn: 's:1', score: 2, tags: [], at: 'y', source: 'user' }),
        JSON.stringify({ v: 1, turn: 's:3', score: 4, tags: [], at: 'y', source: 'user' }),
      ].join('\n'),
      [`${DIR}/signals/2026-10-06.jsonl`]: [
        JSON.stringify({ v: 1, turn: 's:1', at: 'x', signals: { aborted: false, retried: false, correction: false, approval: false, loopNudges: 2, toolErrors: 0, refusals: 0 }, implicitScore: 2, source: 'implicit' }),
        JSON.stringify({ v: 1, turn: 's:2', at: 'x', signals: { aborted: false, retried: false, correction: false, approval: true, loopNudges: 0, toolErrors: 0, refusals: 0 }, implicitScore: 4.5, source: 'implicit' }),
      ].join('\n'),
    },
  }
  prepare(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  const r = await $.command.run({ command: 'ratings', args: '' })
  expect(r.text).toBe(
    [
      'Ratings, last 7 days (Oct 1 to Oct 7)',
      '3 turns recorded, 2 rated by you (67%)',
      'Average: you 3.00, implicit 3.25 (2 with signals)',
      'Per project',
      '  acme: 2 turns, you 2.00 over 1 rating, implicit 3.25',
      '  billing: 1 turn, you 4.00 over 1 rating',
      'Per skill used',
      '  diagnosing-bugs: 1 turn, you 2.00 over 1 rating, implicit 2.00',
      'Effect of signals',
      '  loop nudges: you 2.00 with (1 turn), 4.00 without (1 turn)',
      '  refusals: you none with (0 turns), 3.00 without (2 turns)',
      'Lowest rated',
      '  2/5 s:1 "fix the login bug"',
      '  4/5 s:3 "reconcile the october totals"',
    ].join('\n'),
  )
  expect(r.text.indexOf('2/5 s:1') < r.text.indexOf('4/5 s:3')).toBe(true)
  expect(r.text).not.toContain('outside the window')
  expect(s.opened).toEqual(['ratings'])
})

test('rules: implicit score math, retry similarity, whole-word accent-insensitive phrases, /rate parsing', () => {
  const base = { aborted: false, retried: false, correction: false, approval: false, loopNudges: 0, toolErrors: 0, refusals: 0 }
  expect(implicitScore(base)).toBe(3)
  expect(implicitScore({ ...base, approval: true })).toBe(4.5)
  expect(implicitScore({ ...base, aborted: true, retried: true })).toBe(1)
  expect(implicitScore({ ...base, loopNudges: 5, refusals: 10 })).toBe(1)
  expect(implicitScore({ ...base, loopNudges: 1, refusals: 1 })).toBe(2.3)
  expect(isRetry('fix the invoice total please', 'fix the invoice total')).toBe(true)
  expect(isRetry('fix the invoice total', 'now deploy it')).toBe(false)
  expect(mentions('Tá ERRADO isso', CORRECTION_PHRASES)).toBe(true)
  expect(mentions('nao era isso', CORRECTION_PHRASES)).toBe(true)
  expect(mentions("that's not what I asked", CORRECTION_PHRASES)).toBe(true)
  expect(mentions('ótimo!', APPROVAL_PHRASES)).toBe(true)
  expect(mentions('isso é um boato', APPROVAL_PHRASES)).toBe(false)
  expect(mentions('the topic', APPROVAL_PHRASES)).toBe(false)
  const counts = { aborted: false, loopNudges: 0, toolErrors: 0, refusals: 0 }
  expect(signalsFor(counts, 'x', { text: 'não ficou bom', human: true })).toMatchObject({ correction: true, approval: false })
  expect(parseRate('3 a b -- c d')).toEqual({ kind: 'rate', score: 3, tags: ['a', 'b'], comment: 'c d' })
  expect(parseRate('0')).toEqual({ kind: 'invalid' })
  expect(parseRate('')).toEqual({ kind: 'show' })
})

test('boa and show count as approval only in a short message', () => {
  expect(approves('boa!')).toBe(true)
  expect(approves('show, valeu')).toBe(true)
  expect(approves('boa tarde, me manda o relatório de outubro')).toBe(false)
  expect(approves('show me the file you changed')).toBe(false)
  expect(approves('perfeito, era isso que eu queria')).toBe(true)
})

test('the band drops its hint, then its separators, so the row fits down to 44 columns', async ($, on) => {
  const s: Scene = { appends: [], surfaces: ['terminal'] }
  prepare(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start(start)
  await turn($, 't1', 'rename the column', 'Renamed.')
  const wide = await $.ui.mount(BAND)
  expect(await wide.find({ type: 'Text', text: '/rate 1-5 tags -- note' })).toMatchObject({ props: { dimColor: true } })
  expect(await wide.find({ type: 'Text', text: '·' })).toMatchObject({ props: { dimColor: true } })
  await wide.unmount()
  const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 50 } })
  expect(await narrow.find({ type: 'Text', text: 'Rate' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: '/rate 1-5 tags -- note' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: '·' })).toBeUndefined()
  expect(await narrow.find({ key: 'rate-5' })).toBeDefined()
  // Five plain buttons take 33 columns; Rate, the separators and the hint add the rest.
  expect(bandLayout(50)).toEqual({ label: 'Rate', separators: false, hint: null })
  expect(bandLayout(70)).toEqual({ label: 'Rate', separators: true, hint: null })
  expect(bandLayout(100)).toEqual({ label: 'Rate', separators: true, hint: '/rate 1-5 tags -- note' })
})

test('a session in a temporary folder or with a temporary config is a test', () => {
  expect(isTemporary('/tmp/x', undefined, undefined)).toBe(true)
  expect(isTemporary('/tmp', undefined, undefined)).toBe(true)
  expect(isTemporary('/home/me/work', '/tmp/claude-1000/cfg', undefined)).toBe(true)
  expect(isTemporary('/home/me/scratch', undefined, '/home/me/scratch')).toBe(true)
  expect(isTemporary('/home/me/work', '/home/me/.claude', '/tmp')).toBe(false)
  expect(isTemporary('/tmpfoo/work', undefined, undefined)).toBe(false)
})

test('a session opened in /tmp writes nothing to the dataset and shows no band', async ($, on) => {
  const s: Scene = { appends: [], surfaces: ['terminal'] }
  prepare(on, s)
  on('ui.render', () => OTHER_MODS)
  await $.session.start({ ...start, cwd: '/tmp/claude-1000/scratch' })
  await turn($, 't1', 'responda só ok', 'ok')
  expect(lines(s, 'turns')).toEqual([])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'rate-1' })).toBeUndefined()
})

test('in a temporary session, /rate says why nothing is recorded and /ratings still reads the dataset', async ($, on) => {
  const s: Scene = { appends: [], surfaces: ['terminal'] }
  prepare(on, s)
  await $.session.start({ ...start, cwd: '/tmp/claude-1000/scratch' })
  await turn($, 't1', 'responda só ok', 'ok')
  const rated = await $.command.run({ command: 'rate', args: '4' })
  expect(rated.text).toContain('temporary folder')
  expect(lines(s, 'ratings')).toEqual([])
  const report = await $.command.run({ command: 'ratings', args: '' })
  expect(report.text).not.toContain('HOME is not set')
})
