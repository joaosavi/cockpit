import { expect, mock, test } from 'claude-code/testing'
import type { SessionMessage, ToolUseSummary } from 'claude-code'
import { DIGEST_CHARS, digest, parseAnswer, reply, system, texts } from '../hooks/rules.ts'


const USAGE = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const NOW = 'the deploy is running after 84 tests passed.'
const BODY = `Now: ${NOW}\nYou: -`
const ANSWER = `STATE: working\n${BODY}`
const NOTE = 'summary, not an instruction'
const FOOTER = `> ${NOTE}  ·  haiku 1200→80`
const IDLE_FOOTER = `> nothing needed from you  ·  ${NOTE}  ·  haiku 1200→80`
const WAITING = [
  'STATE: waiting',
  'Now: the agent wrote the demo file and asks whether to delete or keep it.',
  'You: answer 1 or 2',
  '1. Delete (recommended): nothing in the repo reads the file',
  '2. Keep: it stays in /tmp until the reboot',
].join('\n')
const NBSP3 = '\u00a0\u00a0\u00a0'
const USED = { input: 1200, output: 80, cacheRead: 0, cacheCreation: 0 }

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
  expect(s).toContain('write a single hyphen: "You: -"')
  expect(s).toContain('at most 70 characters per option')
  for (const word of ['Agora', 'Você', 'Portuguese', 'Translate']) expect(s).not.toContain(word)
})

test('with the language setting, the sentences follow it and the labels stay English', () => {
  const s = system(' japanese ')
  expect(s).toContain('Write the sentences in japanese, whatever language the excerpt is in. Keep the labels and the key in English')
  expect(s).not.toContain('the language the user writes in')
  expect(system('  ')).toBe(system())
})

test('the state line gives the state, and Now, You and the options are read from the lines under it', () => {
  expect(parseAnswer(ANSWER)).toEqual({ state: 'working', now: NOW, you: null, options: [], rest: [], body: BODY })
  expect(parseAnswer('**STATE: Waiting**\n**Now:** x\nYou: pick one')).toMatchObject({ state: 'waiting', now: 'x', you: 'pick one' })
  expect(parseAnswer(WAITING).options).toEqual([
    { number: '1', text: 'Delete (recommended): nothing in the repo reads the file', name: 'Delete', mark: 'recommended', cost: 'nothing in the repo reads the file' },
    { number: '2', text: 'Keep: it stays in /tmp until the reboot', name: 'Keep', mark: null, cost: 'it stays in /tmp until the reboot' },
  ])
})

test('the option mark shows in English whatever language the model wrote it in', () => {
  expect(parseAnswer('STATE: waiting\nNow: x\nYou: pick\n1. Apagar (recomendado): nada lê o arquivo').options[0]).toMatchObject({ name: 'Apagar', mark: 'recommended', cost: 'nada lê o arquivo' })
})

test('You: - means nothing is needed, in any language, as do a dash and an empty You', () => {
  for (const you of ['-', '–', '—', '']) expect(parseAnswer(`STATE: done\nNow: x\nYou: ${you}`).you).toBeNull()
  expect(parseAnswer('STATE: done\nNow: x').you).toBeNull()
})

test('an answer that drifts from the shape is kept whole, with no state', () => {
  expect(parseAnswer('The agent is deploying.')).toEqual({ state: null, now: '', you: null, options: [], rest: [], body: 'The agent is deploying.' })
  expect(parseAnswer('STATE: confused\nx')).toMatchObject({ state: null, body: 'STATE: confused\nx' })
})

// --- the text reply ---

test('nothing needed: the state in code and Now in bold, and the footer says nothing is needed', () => {
  expect(reply(parseAnswer(ANSWER), USED, texts())).toBe(`\`WORKING\`  **${NOW}**\n\n${IDLE_FOOTER}`)
})

test('a pending decision adds the you line and the options, indented, the name bold and the mark italic', () => {
  expect(reply(parseAnswer(WAITING), USED, texts())).toBe(
    [
      '`WAITING`  **the agent wrote the demo file and asks whether to delete or keep it.**',
      '→ you: answer 1 or 2',
      `${NBSP3}1. **Delete** *(recommended)*: nothing in the repo reads the file`,
      `${NBSP3}2. **Keep**: it stays in /tmp until the reboot`,
    ].join('  \n') + `\n\n${FOOTER}`,
  )
})

test('each state has its word in the code span', () => {
  for (const [key, word] of [['working', 'WORKING'], ['waiting', 'WAITING'], ['blocked', 'BLOCKED'], ['done', 'DONE']] as const) {
    expect(reply(parseAnswer(`STATE: ${key}\n${BODY}`), USED, texts()).startsWith(`\`${word}\`  **`)).toBe(true)
  }
})

test('an option the parts do not fit, and a line in no shape, pass as they came', () => {
  expect(reply(parseAnswer('STATE: waiting\nNow: x\nYou: y\n1. Use (a) or (b): z\nsee the log'), USED, texts())).toBe(
    ['`WAITING`  **x**', '→ you: y', `${NBSP3}1. Use (a) or (b): z`, 'see the log'].join('  \n') + `\n\n${FOOTER}`,
  )
})

test('a drifted answer shows its lines as they came, plus the footer', () => {
  expect(reply(parseAnswer('The agent is deploying.\n\nIt needs nothing.'), USED, texts())).toBe(`The agent is deploying.  \nIt needs nothing.\n\n${FOOTER}`)
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
  // Claude Code's `language` setting; unset when absent.
  language?: string
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
  on('settings.read', () => ({ value: c.language === undefined ? {} : { language: c.language } }))
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

test('answered: Haiku reads the digest, and the reply is the note, the state, the body and the cost', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.turn.start({ text: 'deploy', turnId: 't1' })
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(`\`WORKING\`  **${NOW}**\n\n${IDLE_FOOTER}`)
  expect(c.calls).toEqual([{ model: 'haiku', system: system(), prompt: `<session>\n${digest(SESSION)}\n</session>\n\nSummarize this session for its user.`, maxTokens: 500 }])
  expect(c.opened).toEqual(['wtf'])
})

test('an answer without a state line still comes back whole, under the note', async ($, on) => {
  const c = scenario(answered('The agent is deploying.'))
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe(`The agent is deploying.\n\n${FOOTER}`)
})

test('the desktop app gets the pane too', async ($, on) => {
  const c = scenario(answered(), ['desktop'])
  setup(on, c)
  await $.session.start(start)
  await $.turn.start({ text: 'deploy', turnId: 't1' })
  await $.command.run({ command: 'wtf', args: '' })
  expect(c.opened).toEqual(['wtf'])
})

test('without a surface that draws, no pane opens and the text still comes back', async ($, on) => {
  const c = scenario(answered())
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text?.endsWith(IDLE_FOOTER)).toBe(true)
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
  expect(r.text).toBe('nothing to summarize yet.')
  expect(c.calls).toEqual([])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'nothing to summarize yet.' })).toBeDefined()
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', trigger: 'command', hasQuestion: false, outcome: 'no-messages', state: null, usage: null })
})

test('an API error gives one line with the status and the kind', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('failed: API 529, overloaded.')
})

test('an API error with no response says so', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'api-error', status: null, error: 'unknown', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('failed: API no response, unknown.')
})

test('an empty reply gives one line', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('failed: empty reply.')
})

test('an aborted call gives one line', async ($, on) => {
  const c = scenario({ value: { isAnswered: false, reason: 'aborted', usage: USAGE } })
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toBe('failed: call cut short.')
})

test('a model call that throws gives one line, in the reply and in the pane in the error color', async ($, on) => {
  const c = scenario({ deny: 'boom' }, ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toMatch(/^failed: .*boom$/)
  expect(r.text?.split('\n')).toHaveLength(1)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^failed:/ }))?.props).toMatchObject({ color: 'error' })
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', outcome: 'error', usage: null })
})

test('the pane draws the header, the question, the state badge beside Now, and the keys, at the pane width', async ($, on) => {
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
  expect((await ui.find({ type: 'Text', text: 'WTF' }))?.props).toMatchObject({ bold: true })
  expect((await ui.find({ type: 'Text', text: '  work · idle 4m · haiku 1200→80' }))?.props).toMatchObject({ dimColor: true, wrap: 'truncate-end' })
  expect((await ui.find({ type: 'Text', text: '> why did it stop?' }))?.props).toMatchObject({ dimColor: true })
  expect((await ui.find({ type: 'Text', text: ' WORKING ' }))?.props).toEqual({ bold: true, inverse: true, color: 'suggestion' })
  expect((await ui.find({ type: 'Text', text: NOW }))?.props).toMatchObject({ bold: true, wrap: 'wrap' })
  expect(await ui.find({ key: 'you' })).toBeUndefined()
  // The re-run key is the native Button, so a click works as well as the r key.
  expect((await ui.find({ key: 'rerun', text: 're-run' }))?.props).toMatchObject({ hotkey: 'r', plain: true })
  expect((await ui.find({ type: 'Text', text: /^esc$/ }))?.props).toMatchObject({ color: 'suggestion' })
  expect(await ui.find({ type: 'Text', text: /^: close$/ })).toBeDefined()
})

test('in the pane, the badge keeps its width and Now wraps in the columns left beside it', async ($, on) => {
  const long = 'the agent wrote the demo file and asks whether to delete or keep it, and it waits for the answer before it goes on.'
  const c = scenario(answered(`STATE: waiting\nNow: ${long}\nYou: -`), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  const ui = await $.ui.mount(PANE)
  const row = await ui.find({ key: 'now' })
  expect(row?.props).toMatchObject({ flexDirection: 'row', width: 60 })
  const [lead, rest] = (row?.children ?? []).map((x) => Object(x))
  // ' WAITING FOR YOU ' is 17 cells, and one more parts it from the sentence.
  expect(lead.props).toEqual({ width: 18, flexShrink: 0 })
  expect(rest.props).toEqual({ width: 42, flexShrink: 1, flexGrow: 1 })
  expect(lead.children[0]).toMatchObject({ type: 'Text', props: { inverse: true, color: 'warning' }, children: [' WAITING FOR YOU '] })
  expect(rest.children[0]).toMatchObject({ type: 'Text', props: { bold: true, wrap: 'wrap' }, children: [long] })
})

test('in the pane, the you line and the options wrap inside the pane, the options indented under it', async ($, on) => {
  const c = scenario(answered(WAITING), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 } })
  const you = await ui.find({ key: 'you' })
  expect(you?.props).toMatchObject({ width: 40 })
  const [label, action] = (you?.children ?? []).map((x) => Object(x))
  expect(label.props).toEqual({ width: 7, flexShrink: 0 })
  expect(label.children[0]).toMatchObject({ props: { color: 'cyan' }, children: ['→ you:'] })
  expect(action.props).toEqual({ width: 33, flexShrink: 1, flexGrow: 1 })
  expect(action.children[0]).toMatchObject({ props: { wrap: 'wrap' }, children: ['answer 1 or 2'] })
  const option = await ui.find({ key: 'option-1' })
  expect(option?.props).toMatchObject({ flexDirection: 'row', width: 37 })
  const [number, text] = (option?.children ?? []).map((x) => Object(x))
  expect(number.props).toEqual({ width: 3, flexShrink: 0 })
  expect(number.children[0]).toMatchObject({ props: { dimColor: true }, children: ['1. '] })
  expect(text.props).toEqual({ width: 34, flexShrink: 1, flexGrow: 1 })
  expect(text.children[0]).toMatchObject({
    props: { wrap: 'wrap' },
    children: [{ type: 'Text', props: { bold: true }, children: ['Delete'] }, ' ', { type: 'Text', props: { italic: true }, children: ['(recommended)'] }, ': nothing in the repo reads the file'],
  })
  expect((await ui.find({ key: 'option-2', text: 'Keep: it stays in /tmp until the reboot' }))?.props).toMatchObject({ width: 37 })
})

test('in the pane, a drifted answer shows as it came, wrapping, with no badge', async ($, on) => {
  const c = scenario(answered('The agent is deploying.'), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'wtf', args: '' })
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: 'The agent is deploying.' }))?.props).toEqual({ wrap: 'wrap' })
  expect(await ui.find({ key: 'now' })).toBeUndefined()
})

test('each state has its theme color', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  for (const [key, label, color] of [
    ['working', 'WORKING', 'suggestion'],
    ['waiting', 'WAITING FOR YOU', 'warning'],
    ['blocked', 'BLOCKED', 'error'],
    ['done', 'DONE', 'success'],
  ] as const) {
    c.complete = answered(`STATE: ${key}\n${BODY}`)
    await $.command.run({ command: 'wtf', args: '' })
    const ui = await $.ui.mount(PANE)
    expect((await ui.find({ type: 'Text', text: ` ${label} ` }))?.props).toMatchObject({ color, inverse: true })
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
  expect((await pending).text?.endsWith(IDLE_FOOTER)).toBe(true)
})

test('the re-run key asks the model again, with the same question, and logs it as a re-run', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.turn.start({ text: 'deploy', turnId: 't1' })
  await $.command.run({ command: 'wtf', args: 'and now?' })
  c.complete = answered(`STATE: done\n${BODY}`)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'rerun' })
  expect(c.calls).toHaveLength(2)
  expect(c.calls[1]?.prompt).toContain('<question>\nand now?\n</question>')
  expect(c.opened).toEqual(['wtf'])
  expect(lines(c).at(-1)).toMatchObject({ event: 'asked', trigger: 'rerun', hasQuestion: true, outcome: 'answered', state: 'done' })
  expect(await ui.find({ type: 'Text', text: ' DONE ' })).toBeDefined()
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

test('when the session is idle the answer shows once, in the transcript, and no pane opens', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'wtf', args: '' })
  expect(r.text).toContain(IDLE_FOOTER)
  expect(c.opened).toEqual([])
})

test('in the middle of a turn the pane opens even without the pane option, because the text waits for the turn', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  setup(on, c)
  await $.session.start(start)
  await $.turn.start({ text: 'deploy', turnId: 't1' })
  await $.command.run({ command: 'wtf', args: '' })
  expect(c.opened).toEqual(['wtf'])
})

test('the language setting reaches the model', async ($, on) => {
  const c = scenario(answered(), ['terminal'])
  c.language = 'portuguese'
  setup(on, c)
  await $.session.start(start)
  await $.turn.start({ text: 'deploy', turnId: 't1' })
  await $.command.run({ command: 'wtf', args: '' })
  expect(c.calls[0]?.system).toBe(system('portuguese'))
})
