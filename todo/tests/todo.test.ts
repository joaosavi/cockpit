import { expect, mock, test } from 'claude-code/testing'
import { cleanListId, openTasksNote, parseTask, promptContext } from '../hooks/rules.ts'

type Scene = { files: Map<string, string>; appended: string[]; removed: string[] }

const LIST = '/home/.claude/tasks/demerzel'
const SESSION_LIST = '/home/.claude/tasks/abcdef123456'
const ARCHIVE = '/home/.local/state/mods/todo/demerzel.jsonl'

function task(id: string, subject: string, status: string): string {
  return JSON.stringify({ id, subject, description: `about ${subject}`, status, blocks: [], blockedBy: [] })
}

function scene(entries: Record<string, string> = {}): Scene {
  return { files: new Map(Object.entries(entries)), appended: [], removed: [] }
}

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene, env: Record<string, string> = { HOME: '/home', CLAUDE_CODE_TASK_LIST_ID: 'demerzel' }, onTool?: (e: unknown) => void) {
  mock.clock(on, { now: Date.parse('2026-10-22T13:00:00Z') })
  mock.env(on, env)
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('fs.read', ($, e) => {
    const text = s.files.get(e.path)
    return text === undefined ? { deny: 'no file' } : { value: text }
  })
  on('fs.write', ($, e) => {
    s.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const prefix = `${e.path}/`
    const names = [...s.files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
    if (names.length === 0) return { deny: 'no such folder' }
    return { value: names.map((k) => ({ name: k.slice(prefix.length), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'rm') {
      for (const p of e.argv.slice(2)) {
        s.files.delete(p)
        s.removed.push(p)
      }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.append', ($, e, next) => {
    const block = e.message.content[0]
    s.appended.push(block !== undefined && 'text' in block && typeof block.text === 'string' ? block.text : '')
    return next(e)
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context, origin: e.origin }))
  on('tool.call', ($, e) => {
    onTool?.(e)
    return { result: 'ok', text: 'ok' }
  })
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('the list file is parsed, and anything else is skipped', () => {
  expect(parseTask(task('3', 'a', 'pending'))).toEqual({ id: '3', subject: 'a', status: 'pending', description: 'about a' })
  expect(parseTask('{"id":"1"}')).toBe(null)
  expect(parseTask('not json')).toBe(null)
  expect(parseTask(JSON.stringify({ id: '1', subject: 'a', status: 'deleted' }))).toBe(null)
  expect(cleanListId('my list/1')).toBe('my-list-1')
})

test('the notes list open tasks in id order and say nothing about an empty list', () => {
  const open = [
    { id: '2', subject: '[refactor] port main', description: '', status: 'in_progress' as const },
    { id: '10', subject: '[tcc] title', description: '', status: 'pending' as const },
  ]
  expect(openTasksNote({ list: 'demerzel', open: [], when: 'start' })).toBe(null)
  expect(openTasksNote({ list: 'demerzel', open, when: 'compaction' })).toContain('#2 [in_progress] [refactor] port main\n#10 [pending] [tcc] title')
  expect(promptContext({ list: 'demerzel', open: [], archived: [], remind: false })).toBe(null)
  expect(promptContext({ list: 'demerzel', open: [], archived: [], remind: true })).toContain('becomes a task (TaskCreate) before any other work')
})

test('at start the open tasks go in as a note, and completed ones move to the archive', async ($, on) => {
  const s = scene({
    [`${LIST}/1.json`]: task('1', '[refactor] port main', 'in_progress'),
    [`${LIST}/2.json`]: task('2', '[tcc] new title', 'completed'),
    [`${LIST}/.lock`]: '',
  })
  prepare(on, s)
  await $.session.start(start)
  expect(s.appended).toHaveLength(1)
  expect(s.appended[0]).toContain('#1 [in_progress] [refactor] port main')
  expect(s.appended[0]).not.toContain('tcc')
  expect(s.removed).toEqual([`${LIST}/2.json`])
  const archived = (s.files.get(ARCHIVE) ?? '').trim().split('\n').map((l): unknown => JSON.parse(l))
  expect(archived).toEqual([
    { at: '2026-10-22T13:00:00.000Z', session: 'abcdef12', event: 'archived', list: 'demerzel', id: '2', subject: '[tcc] new title', description: 'about [tcc] new title' },
  ])
})

test('an empty list adds no note at start', async ($, on) => {
  const s = scene()
  prepare(on, s)
  await $.session.start(start)
  expect(s.appended).toEqual([])
})

test('a prompt from the user carries the rule, and the open tasks; a peer message carries nothing', async ($, on) => {
  const s = scene({ [`${LIST}/4.json`]: task('4', '[docs] guide', 'pending') })
  prepare(on, s)
  await $.session.start(start)
  const first = await $.prompt.submit({ text: 'new request', wait: false, origin: { kind: 'bridge' } })
  expect(first).toMatchObject({ context: [expect.stringContaining('before any other work')] })
  expect(first).toMatchObject({ context: [expect.stringContaining('#4 [pending] [docs] guide')] })
  s.files.set(`${LIST}/5.json`, task('5', '[zippi] issue', 'pending'))
  const changed = await $.prompt.submit({ text: 'another', wait: false, origin: { kind: 'composer' } })
  expect(changed).toMatchObject({ context: [expect.stringContaining('#4 [pending] [docs] guide\n#5 [pending] [zippi] issue')] })
  s.files.set(`${LIST}/4.json`, task('4', '[docs] guide', 'completed'))
  const closed = await $.prompt.submit({ text: 'and now', wait: false, origin: { kind: 'composer' } })
  expect(closed).toMatchObject({ context: [expect.stringContaining('Completed and archived since the last prompt:\n#4 [docs] guide\nOpen tasks now:\n#5')] })
  const peer = await $.prompt.submit({ text: 'agent done', wait: false, origin: { kind: 'peer' } })
  expect(Reflect.get(peer, 'context')).toBe(undefined)
})

test('without a named list the rule stays out, and the session list is read', async ($, on) => {
  const s = scene()
  prepare(on, s, { HOME: '/home' })
  await $.session.start(start)
  s.files.set(`${SESSION_LIST}/1.json`, task('1', 'write tests', 'pending'))
  const r = await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
  const ctx: unknown = Reflect.get(r, 'context')
  expect(ctx).toEqual(['Open tasks now:\n#1 [pending] write tests'])
})

test('a task marked completed leaves the list at once', async ($, on) => {
  const s = scene({ [`${LIST}/1.json`]: task('1', '[a] one', 'pending') })
  prepare(on, s, undefined, () => s.files.set(`${LIST}/1.json`, task('1', '[a] one', 'completed')))
  await $.session.start(start)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  expect(s.files.has(`${LIST}/1.json`)).toBe(false)
  expect(s.files.get(ARCHIVE)).toContain('"id":"1"')
})

test('with archive off, a completed task stays in the list', { options: { archive: false } }, async ($, on) => {
  const s = scene({ [`${LIST}/1.json`]: task('1', '[a] one', 'completed') })
  prepare(on, s)
  await $.session.start(start)
  expect(s.files.has(`${LIST}/1.json`)).toBe(true)
  expect(s.removed).toEqual([])
})

test('after a compaction the open tasks are the last message', async ($, on) => {
  const s = scene({ [`${LIST}/7.json`]: task('7', '[zippi] issue 282', 'pending') })
  prepare(on, s)
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }))
  await $.session.start(start)
  const r = await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'old', toolUses: [] }] })
  expect(r).toMatchObject({ messages: [{ text: 'summary' }, { role: 'user', text: expect.stringContaining('#7 [pending] [zippi] issue 282') }] })
  const pre = await $.session.compact({ trigger: 'precompute', messages: [{ role: 'user', text: 'old', toolUses: [] }] })
  expect(Reflect.get(pre, 'messages')).toHaveLength(1)
})

test('disabled, the mod adds nothing', { options: { enabled: false } }, async ($, on) => {
  const s = scene({ [`${LIST}/1.json`]: task('1', '[a] one', 'completed') })
  prepare(on, s)
  await $.session.start(start)
  const r = await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
  expect(Reflect.get(r, 'context')).toBe(undefined)
  expect(s.appended).toEqual([])
  expect(s.files.has(`${LIST}/1.json`)).toBe(true)
})
