import { expect, mock, test } from 'claude-code/testing'
import type { SessionMessage, ToolUseSummary } from 'claude-code'
import { DIGEST_CHARS, digest, parseAnswer, system } from '../hooks/rules.ts'

const WITH_PANE = { options: { pane: true } }

const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BODY = 'Now: the deploy is running after 84 tests passed.\nYou: nothing.'
const ANSWER = `STATE: working\n${BODY}`
const NOTE = 'summary, not an instruction.'

function user(text: string): SessionMessage {
  return { role: 'user', text, toolUses: [] }
}

function assistant(text: string, toolUses: ToolUseSummary[] = []): SessionMessage {
  return { role: 'assistant', text, toolUses }
}

function use(tool: string, input: Record<string, unknown>, outcome: Partial<ToolUseSummary> = {}): ToolUseSummary {
  return { tool_use_id: `id-${tool}`, tool, input, ...outcome }
}

const SESSION: SessionMessage[] = [
  user('Deploy V2 to Coolify'),
  assistant('Running the tests first.', [use('Bash', { command: 'yarn test' }, { text: '84 passed' })]),
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'id-Bash', text: '84 passed', isError: false }] },
  assistant('Tests pass. Deploying.', [use('Bash', { command: 'yarn deploy' })]),
]

// --- the digest ---

test('the digest of a short session lists every message and marks the running tool call', () => {
  expect(digest(SESSION)).toBe(
    [
      'The last messages, oldest first:',
      'user: Deploy V2 to Coolify',
      'assistant: Running the tests first.',
      'tool Bash yarn test -> 84 passed',
      'assistant: Tests pass. Deploying.',
      'tool Bash yarn deploy -> (still running)',
    ].join('\n'),
  )
})

test('the opener stays when it is older than the last 12 messages, and only the last 12 follow', () => {
  const messages = [user('The original task'), ...Array.from({ length: 20 }, (_, i) => assistant(`step ${i}`))]
  const d = digest(messages)
  expect(d.startsWith('The task opener (the first user message):\nuser: The original task\n\nThe last messages, oldest first:\n')).toBe(true)
  expect(d).not.toContain('step 7\n')
  expect(d).toContain('assistant: step 8\n')
  expect(d.endsWith('assistant: step 19')).toBe(true)
  expect(d.match(/^assistant: /gm)).toHaveLength(12)
})

test('cuts the opener to 800 characters, a message to 500, an input to 120 and a result to 200', () => {
  const messages = [
    user('o'.repeat(2000)),
    ...Array.from({ length: 12 }, () => assistant('m'.repeat(900))),
    assistant('', [use('Bash', { command: 'c'.repeat(300) }, { text: 'r'.repeat(900) })]),
  ]
  const lines = digest(messages).split('\n')
  expect(lines.find((l) => l.startsWith('user: '))).toBe(`user: ${'o'.repeat(799)}…`)
  expect(lines.find((l) => l.startsWith('assistant: '))).toBe(`assistant: ${'m'.repeat(499)}…`)
  expect(lines.at(-1)).toBe(`tool Bash ${'c'.repeat(119)}… -> ${'r'.repeat(199)}…`)
})

test('a tool call shows an error, its file or its description, and turns its result into one line', () => {
  const d = digest([
    assistant('', [
      use('Read', { file_path: '/a/b.ts' }, { isError: true, text: 'no such file' }),
      use('Agent', { description: 'Find the bug', prompt: 'long' }, { result: { status: 'done' } }),
      use('Grep', { pattern: 'TODO' }, { text: 'a.ts:1\nb.ts:2' }),
    ]),
  ])
  expect(d).toContain('tool Read /a/b.ts -> error')
  expect(d).toContain('tool Agent Find the bug -> {"status":"done"}')
  expect(d).toContain('tool Grep TODO -> a.ts:1 b.ts:2')
})

test('over 12,000 characters, the oldest of the last messages go first', () => {
  const big = (i: number) => assistant(`${i} ${'x'.repeat(498)}`, Array.from({ length: 6 }, () => use('Bash', { command: 'y'.repeat(200) }, { text: 'z'.repeat(300) })))
  const messages = [user('open'), ...Array.from({ length: 14 }, (_, i) => big(i))]
  const d = digest(messages)
  expect(d.length).toBeLessThanOrEqual(DIGEST_CHARS)
  expect(d).toContain('user: open')
  expect(d).toContain('assistant: 13 ')
  expect(d).not.toContain('assistant: 2 ')
})

// --- the system prompt ---

test('the system prompt keeps English labels and asks for the user\'s language in the sentences', () => {
  const s = system()
  expect(s).toContain('Write the sentences in the language the user writes in the excerpt.')
  expect(s).toContain('STATE: <key>\nNow: one short sentence')
  expect(s).toContain('You: the one action')
  for (const word of ['Agora', 'Você', 'Portuguese', 'Translate']) expect(s).not.toContain(word)
})

test('the state line gives the state and its word, and the lines under it are the body', () => {
  expect(parseAnswer(ANSWER)).toEqual({ state: 'working', label: 'Working', body: BODY })
  expect(parseAnswer('**STATE: Waiting**\nNow: x')).toEqual({ state: 'waiting', label: 'Waiting for you', body: 'Now: x' })
})

test('an answer that drifts from the shape is shown whole, with no state', () => {
  expect(parseAnswer('The agent is deploying.')).toEqual({ state: null, label: '', body: 'The agent is deploying.' })
  expect(parseAnswer('STATE: confused\nx')).toEqual({ state: null, label: '', body: 'STATE: confused\nx' })
})

// --- the command ---

type Complete = { value: unknown } | { deny: string }

type Scenario = {
  complete: Complete
  messages: SessionMessage[]
  surfaces?: string[]
  // How long the model takes, in mock-clock milliseconds; 0 answers at once.
  modelMs?: number
  // The session id `$.session.id()` returns; `/clear` changes it without reloading the mod.
  sessionId?: string
  // What the mod sent to the model, the panes it opened and the lines it wrote to its diary.
  calls: { model: string; system: unknown; prompt: unknown; maxTokens: unknown }[]
  opened: string[]
  written: string[]
}

function setup(on: Parameters<Parameters<typeof test>[1]>[1], c: Scenario) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: c.sessionId ?? 'abcdef123456' }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  // The diary reads back what it wrote, so each write holds every line so far.
  on('fs.read', () => (c.written.length === 0 ? { deny: 'no file' } : { value: c.written.at(-1) ?? '' }))
  on('fs.write', ($, e) => {
    c.written.push(e.text)
    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: c.surfaces ?? [] }))
  on('session.messages', () => ({ value: c.messages }))
  on('ui.open', ($, e) => {
    c.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('model.complete', async ($, e) => {
    c.calls.push({ model: e.model, system: e.system, prompt: e.prompt, maxTokens: e.maxTokens })
    if ((c.modelMs ?? 0) > 0) await clock.sleep(c.modelMs ?? 0)
    return c.complete
  })
  on('session.start', () => ({ cwd: '/home/me/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '', reason: 'answer' }))
  return clock
}

function scenario(complete: Complete, surfaces?: string[], messages: SessionMessage[] = SESSION): Scenario {
  return { complete, messages, surfaces, calls: [], opened: [], written: [] }
}

const answered = (text = ANSWER): Complete => ({ value: { isAnswered: true, text, usage: USAGE } })

const start = { surface: 'terminal', isInteractive: true, cwd: '/home/me/work' } as const

const PANE = {
  plugin: 'wtf',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'wtf',
  props: { title: 'WTF', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// Each line the mod wrote, parsed. The last write holds every line.
function lines(c: Scenario): unknown[] {
  return (c.written.at(-1) ?? '')
    .split('\n')
    .filter((l) => l !== '')
    .map((l): unknown => JSON.parse(l))
}

test('answered: Haiku reads the digest, and the reply is the note, the state, the body and the cost', WITH_PANE, async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(`${NOTE}\n\n**Working**\n${BODY}\n\nhaiku · 1200→80 tokens`)
  expect(c.calls).toEqual([{ model: 'haiku', system: system(), prompt: `<session>\n${digest(SESSION)}\n</session>\n\nSummarize this session for its user.`, maxTokens: 500 }])
  expect(c.opened).toEqual(['wtf'])
})

test('an answer without a state line still comes back whole, under the note', async ($, on) => {
  const c = scenario(answered('The agent is deploying.'))
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(`${NOTE}\n\nThe agent is deploying.\n\nhaiku · 1200→80 tokens`)
})

test('the desktop app gets the pane too', WITH_PANE, async ($, on) => {
  const c = scenario(answered(), ['desktop'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  expect(c.opened).toEqual(['wtf'])
})

test('without a surface that draws, no pane opens and the text still comes back', async ($, on) => {
  const c = scenario(answered())
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text?.startsWith(NOTE)).toBe(true)
  expect(c.opened).toEqual([])
})

test('the text typed after /wtf goes into the prompt as the question', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '  why did the deploy stop?  ' })
  expect(c.calls).toHaveLength(1)
  expect(c.calls[0]?.prompt).toBe(`<session>\n${digest(SESSION)}\n</session>\n\nThe user asks this specifically. Answer it in the same shape:\n<question>\nwhy did the deploy stop?\n</question>`)
})

test('no messages gives one line without calling the model', async ($, on) => {
  const c = scenario(answered(), ['terminal'], [])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('/wtf: nothing to summarize yet.')
  expect(c.calls).toEqual([])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '/wtf: nothing to summarize yet.' })).toBeDefined()
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', trigger: 'command', hasQuestion: false, outcome: 'no-messages', state: null, usage: null })
})

test('an API error gives one line with the status and the kind', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('/wtf failed: API 529, overloaded.')
})

test('an API error with no response says so', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'api-error', status: null, error: 'unknown', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('/wtf failed: API no response, unknown.')
})

test('an empty reply gives one line', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('/wtf failed: empty reply.')
})

test('an aborted call gives one line', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'aborted', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('/wtf failed: call cut short.')
})

test('a model call that throws gives one line, in the reply and in the pane in the error color', async ($, on) => {
  const c = scenario({ deny: 'boom' }, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toMatch(/^\/wtf failed: .*boom$/)
  expect(r.text?.split('\n')).toHaveLength(1)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^\/wtf failed:/ }))?.props).toMatchObject({ color: 'error' })
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', outcome: 'error', usage: null })
})

test('the pane draws the header, the question, the state badge, the body and the keys, at the pane width', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  const clock = setup(on, c)
  await $.session.start(start)
  await $.turn.start({ text: 'deploy', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(4 * 60_000)
  await $.command.run({ command: 'wtf', args: 'why did it stop?' })
  const ui = await $.ui.mount(PANE)
  const root = await ui.drawn()
  expect(root.props).toMatchObject({ flexDirection: 'column', width: 60 })
  expect(await ui.find({ type: 'Text', text: 'WTF' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  work · idle 4m · haiku · 1200→80 tokens' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '> why did it stop?' }))?.props).toMatchObject({ dimColor: true })
  expect((await ui.find({ type: 'Text', text: ' Working ' }))?.props).toMatchObject({ backgroundColor: 'suggestion', color: 'inverseText', bold: true })
  expect(await ui.find({ type: 'Markdown', text: BODY })).toBeDefined()
  expect(await ui.find({ key: 'rerun', text: 'Re-run' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Esc: close' })).toBeDefined()
})

test('each state has its theme color', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  for (const [key, label, color] of [
    ['waiting', 'Waiting for you', 'warning'],
    ['blocked', 'Blocked', 'error'],
    ['done', 'Done', 'success'],
  ] as const) {
    c.complete = answered(`STATE: ${key}\n${BODY}`)
    await $.command.run({ command: 'wtf', args: '' })
    const ui = await $.ui.mount(PANE)
    expect((await ui.find({ type: 'Text', text: ` ${label} ` }))?.props).toMatchObject({ backgroundColor: color })
    await ui.unmount()
  }
})

test('while the model answers the pane says it is reading, shows a running turn and hides the re-run key', async ($, on) => {
  const c = { ...scenario(answered(), ['terminal']), modelMs: 1000 }
  const clock = setup(on, c)
  await $.session.start(start)
  await $.turn.start({ text: 'deploy', turnId: 't1' })
  const pending = $.command.run({ command: 'wtf', args: '' })
  await clock.advance(10)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'Reading…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  work · running · haiku' })).toBeDefined()
  expect(await ui.find({ key: 'rerun' })).toBeUndefined()
  await clock.advance(1000)
  expect((await pending).text?.startsWith(NOTE)).toBe(true)
})

test('the re-run key asks the model again, with the same question, and logs it as a re-run', WITH_PANE, async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: 'and now?' })
  c.complete = answered(`STATE: done\n${BODY}`)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'rerun' })
  expect(c.calls).toHaveLength(2)
  expect(c.calls[1]?.prompt).toContain('<question>\nand now?\n</question>')
  expect(c.opened).toEqual(['wtf'])
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', trigger: 'rerun', hasQuestion: true, outcome: 'answered', state: 'done' })
  expect(await ui.find({ type: 'Text', text: ' Done ' })).toBeDefined()
})

// --- the diary ---

test('the diary line has the outcome, the state, the time and the usage, and never the question or the answer', async ($, on) => {
  const c = scenario(answered())
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: 'secret question' })
  expect(lines(c).at(-1)).toMatchObject({
    at: '1970-01-01T00:00:00.000Z',
    session: 'abcdef12',
    event: 'asked',
    trigger: 'command',
    hasQuestion: true,
    outcome: 'answered',
    state: 'working',
    ms: 0,
    usage: { input: 1200, output: 80, cacheRead: 0, cacheCreation: 0 },
    digestChars: digest(SESSION).length,
  })
  const all = c.written.join('\n')
  expect(all).not.toContain('secret question')
  expect(all).not.toContain('deploy is running')
  expect(all).not.toContain('Coolify')
})

test('each diary line carries the session id of the moment it is written, so /clear shows up', async ($, on) => {
  const c = scenario(answered())
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  c.sessionId = '99887766aabb'
  await $.command.run({ command: 'wtf', args: '' })
  expect(lines(c).map((l) => Reflect.get(Object(l), 'session'))).toEqual(['abcdef12', '99887766'])
})

test('the session ends with one summary line: uses by outcome and their tokens', async ($, on) => {
  const c = scenario(answered())
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  await $.command.run({ command: 'wtf', args: 'and now?' })
  c.complete = { value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }
  await $.command.run({ command: 'wtf', args: '' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const all = lines(c)
  expect(all.at(-1)).toMatchObject({
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/home/me/work',
    toolCalls: 0,
    actions: { answered: 2, 'empty-reply': 1 },
    asked: 3,
    modelMs: 0,
    inputTokens: 3600,
    outputTokens: 240,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  })
  expect(all.filter((l) => JSON.stringify(l).includes('session-summary'))).toHaveLength(1)
})

test('without the pane option the answer shows once, in the transcript, and no pane opens', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toContain('summary, not an instruction.')
  expect(c.opened).toEqual([])
})
