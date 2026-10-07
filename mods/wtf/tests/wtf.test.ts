import { expect, mock, test } from 'claude-code/testing'
import { NOTHING, PROMPT } from '../hooks/rules.ts'

const USAGE = { input_tokens: 12, output_tokens: 80, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 300 }
const ANSWER = 'Onde estamos: o deploy parou no teste.\nO que eu preciso de você: nada, sigo sozinho.'

type Fork = { value: unknown } | { deny: string }

type Scenario = {
  fork: Fork
  surfaces?: string[]
  // What the mod sent to the fork, the panes it opened and the lines it wrote to its diary.
  prompts: string[]
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
  on('ui.open', ($, e) => {
    c.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('model.fork', ($, e) => {
    c.prompts.push(e.prompt)
    return c.fork
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
}

function scenario(fork: Fork, surfaces?: string[]): Scenario {
  return { fork, surfaces, prompts: [], opened: [], written: [] }
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const PANE = {
  plugin: 'wtf',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'wtf',
  props: { title: 'WTF', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// Each line the mod wrote, parsed. The diary rewrites the whole file, so the last write holds every line.
function lines(c: Scenario): unknown[] {
  return (c.written.at(-1) ?? '')
    .split('\n')
    .filter((l) => l !== '')
    .map((l): unknown => JSON.parse(l))
}

test('answered: returns the text and opens the WTF pane with it in the terminal', async ($, on) => {
  const c = scenario({ value: { isAnswered: true, text: ANSWER, usage: USAGE } }, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(ANSWER)
  expect(c.prompts).toEqual([PROMPT])
  expect(c.opened).toEqual(['wtf'])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Markdown', text: ANSWER })).toBeDefined()
})

test('the desktop app gets the pane too', async ($, on) => {
  const c = scenario({ value: { isAnswered: true, text: ANSWER, usage: USAGE } }, ['desktop'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  expect(c.opened).toEqual(['wtf'])
})

test('without a surface that draws, no pane opens and the text still comes back', async ($, on) => {
  const c = scenario({ value: { isAnswered: true, text: ANSWER, usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(ANSWER)
  expect(c.opened).toEqual([])
})

test('the text typed after /wtf goes into the prompt as the question', async ($, on) => {
  const c = scenario({ value: { isAnswered: true, text: ANSWER, usage: USAGE } }, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '  por que parou no deploy?  ' })
  expect(c.prompts).toHaveLength(1)
  expect(c.prompts[0]).toContain(PROMPT)
  expect(c.prompts[0]).toContain('<question>\npor que parou no deploy?\n</question>')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '> por que parou no deploy?' })).toBeDefined()
})

test('nothing to fork gives the exact message', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'nothing-to-fork' } }, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(NOTHING)
  expect(r.text).toBe('Ainda não tem nada nesta sessão para resumir.')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: NOTHING })).toBeDefined()
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

test('an aborted fork gives one line', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'aborted', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('Não consegui resumir: a chamada foi interrompida antes da resposta.')
})

test('a fork that throws gives one line, in the reply and in the pane', async ($, on) => {
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

test('the diary line has the outcome and the usage, and never the question or the answer', async ($, on) => {
  const c = scenario({ value: { isAnswered: true, text: ANSWER, usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: 'segredo da pergunta' })
  const last = lines(c).at(-1)
  expect(last).toMatchObject({
    event: 'asked',
    hasQuestion: true,
    outcome: 'answered',
    ms: 0,
    usage: { input: 12, output: 80, cacheRead: 40_000, cacheCreation: 300 },
  })
  const all = c.written.join('\n')
  expect(all).not.toContain('segredo da pergunta')
  expect(all).not.toContain('deploy parou')
})

test('the diary line of a failure keeps its reason, and nothing-to-fork carries no usage', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'nothing-to-fork' } })
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', hasQuestion: false, outcome: 'nothing-to-fork', usage: null })
})

test('the session ends with one summary line: uses by outcome and their tokens', async ($, on) => {
  const c = scenario({ value: { isAnswered: true, text: ANSWER, usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  await $.command.run({ command: 'wtf', args: 'e agora?' })
  c.fork = { value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }
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
    inputTokens: 36,
    outputTokens: 240,
    cacheReadTokens: 120_000,
    cacheCreationTokens: 900,
  })
  expect(all.filter((l) => JSON.stringify(l).includes('session-summary'))).toHaveLength(1)
})
