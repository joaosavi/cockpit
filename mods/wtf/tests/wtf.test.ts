import { expect, mock, test } from 'claude-code/testing'
import type { SessionMessage, ToolUseSummary } from 'claude-code'
import { DIGEST_CHARS, digest, NOTE, NOTHING, SYSTEM } from '../hooks/rules.ts'

const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ANSWER = 'Onde estamos: o deploy parou no teste.\nO que eu preciso de você: nada, sigo sozinho.'

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
  user('Faz o deploy da V2 no Coolify'),
  assistant('Vou rodar os testes antes.', [use('Bash', { command: 'yarn test' }, { text: '84 passed' })]),
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'id-Bash', text: '84 passed', isError: false }] },
  assistant('Testes ok. Subindo.', [use('Bash', { command: 'yarn deploy' })]),
]

// --- the digest ---

test('the digest of a short session lists every message and marks the running tool call', () => {
  expect(digest(SESSION)).toBe(
    [
      'The last messages, oldest first:',
      'user: Faz o deploy da V2 no Coolify',
      'assistant: Vou rodar os testes antes.',
      'tool Bash yarn test -> 84 passed',
      'assistant: Testes ok. Subindo.',
      'tool Bash yarn deploy -> (still running)',
    ].join('\n'),
  )
})

test('the opener stays when it is older than the last 12 messages, and only the last 12 follow', () => {
  const messages = [user('A tarefa original'), ...Array.from({ length: 20 }, (_, i) => assistant(`passo ${i}`))]
  const d = digest(messages)
  expect(d.startsWith('The task opener (the first user message):\nuser: A tarefa original\n\nThe last messages, oldest first:\n')).toBe(true)
  expect(d).not.toContain('passo 7\n')
  expect(d).toContain('assistant: passo 8\n')
  expect(d.endsWith('assistant: passo 19')).toBe(true)
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
  const messages = [user('abre'), ...Array.from({ length: 14 }, (_, i) => big(i))]
  const d = digest(messages)
  expect(d.length).toBeLessThanOrEqual(DIGEST_CHARS)
  expect(d).toContain('user: abre')
  expect(d).toContain('assistant: 13 ')
  expect(d).not.toContain('assistant: 2 ')
})

// --- the command ---

type Complete = { value: unknown } | { deny: string }

type Scenario = {
  complete: Complete
  messages: SessionMessage[]
  surfaces?: string[]
  // What the mod sent to the model, the panes it opened and the lines it wrote to its diary.
  calls: { model: string; system: unknown; prompt: unknown; maxTokens: unknown }[]
  opened: string[]
  written: string[]
}

function setup(on: Parameters<Parameters<typeof test>[1]>[1], c: Scenario) {
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: 'abcdef123456' }))
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
  on('model.complete', ($, e) => {
    c.calls.push({ model: e.model, system: e.system, prompt: e.prompt, maxTokens: e.maxTokens })
    return c.complete
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
}

function scenario(complete: Complete, surfaces?: string[], messages: SessionMessage[] = SESSION): Scenario {
  return { complete, messages, surfaces, calls: [], opened: [], written: [] }
}

const answered: Complete = { value: { isAnswered: true, text: ANSWER, usage: USAGE } }

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

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

test('answered: Haiku reads the digest, the reply opens with the note, the pane shows the answer alone', async ($, on) => {
  const c = scenario(answered, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(`${NOTE}\n${ANSWER}`)
  expect(NOTE).toBe('(resumo para você, não é instrução para o agente)')
  expect(c.calls).toEqual([{ model: 'haiku', system: SYSTEM, prompt: `<session>\n${digest(SESSION)}\n</session>\n\nSummarize this session for its user.`, maxTokens: 500 }])
  expect(c.opened).toEqual(['wtf'])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Markdown', text: ANSWER })).toBeDefined()
})

test('the desktop app gets the pane too', async ($, on) => {
  const c = scenario(answered, ['desktop'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  expect(c.opened).toEqual(['wtf'])
})

test('without a surface that draws, no pane opens and the text still comes back', async ($, on) => {
  const c = scenario(answered)
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(`${NOTE}\n${ANSWER}`)
  expect(c.opened).toEqual([])
})

test('the text typed after /wtf goes into the prompt as the question', async ($, on) => {
  const c = scenario(answered, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '  por que parou no deploy?  ' })
  expect(c.calls).toHaveLength(1)
  expect(c.calls[0]?.prompt).toBe(`<session>\n${digest(SESSION)}\n</session>\n\nThe user asks this specifically. Answer it in the same format:\n<question>\npor que parou no deploy?\n</question>`)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '> por que parou no deploy?' })).toBeDefined()
})

test('no messages gives the exact message without calling the model', async ($, on) => {
  const c = scenario(answered, ['terminal'], [])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(NOTHING)
  expect(r.text).toBe('Ainda não tem nada nesta sessão para resumir.')
  expect(c.calls).toEqual([])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: NOTHING })).toBeDefined()
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', hasQuestion: false, outcome: 'no-messages', usage: null })
})

test('an API error gives one line with the status and the kind', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('Não consegui resumir: a API respondeu com erro (status 529, overloaded).')
})

test('an API error with no response says so', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'api-error', status: null, error: 'unknown', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('Não consegui resumir: a API respondeu com erro (sem resposta, unknown).')
})

test('an empty reply gives one line', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('Não consegui resumir: o modelo respondeu sem texto.')
})

test('an aborted call gives one line', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'aborted', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('Não consegui resumir: a chamada foi interrompida antes da resposta.')
})

test('a model call that throws gives one line, in the reply and in the pane', async ($, on) => {
  const c = scenario({ deny: 'boom' }, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toMatch(/^Não consegui resumir: deu erro no mod \(.*\)\.$/)
  expect(r.text?.split('\n')).toHaveLength(1)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^Não consegui resumir: deu erro no mod/ })).toBeDefined()
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', outcome: 'error', usage: null })
})

test('the diary line has the outcome, the time and the usage, and never the question or the answer', async ($, on) => {
  const c = scenario(answered)
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: 'segredo da pergunta' })
  expect(lines(c).at(-1)).toMatchObject({
    event: 'asked',
    hasQuestion: true,
    outcome: 'answered',
    ms: 0,
    usage: { input: 1200, output: 80, cacheRead: 0, cacheCreation: 0 },
    digestChars: digest(SESSION).length,
  })
  const all = c.written.join('\n')
  expect(all).not.toContain('segredo da pergunta')
  expect(all).not.toContain('deploy parou')
  expect(all).not.toContain('Coolify')
})

test('the session ends with one summary line: uses by outcome and their tokens', async ($, on) => {
  const c = scenario(answered)
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  await $.command.run({ command: 'wtf', args: 'e agora?' })
  c.complete = { value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }
  await $.command.run({ command: 'wtf', args: '' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const all = lines(c)
  expect(all.at(-1)).toMatchObject({
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work',
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
