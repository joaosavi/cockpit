import { expect, mock, test } from 'claude-code/testing'
import { cleanListId, groups, isCompacted, openTasksNote, panelCalls, panelFromMessages, panelUpdate, parseTask, promptContext, type Task, withUnknown } from '../hooks/rules.ts'

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
  const clock = mock.clock(on, { now: Date.parse('2026-10-22T13:00:00Z') })
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
  return clock
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('the list file is parsed, and anything else is skipped', () => {
  expect(parseTask(task('3', 'a', 'pending'))).toEqual({ id: '3', subject: 'a', status: 'pending', description: 'about a' })
  expect(parseTask('{"id":"1"}')).toBe(null)
  expect(parseTask('not json')).toBe(null)
  expect(parseTask(JSON.stringify({ id: '1', subject: 'a', status: 'deleted' }))).toBe(null)
  expect(cleanListId('my list/1')).toBe('my-list-1')
})

test('the priority and the state come from the metadata, then from the subject', () => {
  const raw = JSON.stringify({ id: '9', subject: '[a] x', status: 'pending', metadata: { priority: 'P1', state: 'fila' } })
  expect(parseTask(raw)).toEqual({ id: '9', subject: '[a] x', description: '', status: 'pending', priority: 'P1', state: 'fila' })
  const t = (id: string, subject: string, status: Task['status'] = 'pending', meta: Partial<Task> = {}): Task => ({ id, subject, description: '', status, ...meta })
  const open = [
    t('1', '[a] no tag at all'),
    t('2', '[b] P2 fila: disk cleanup'),
    t('3', '[c] P1 fila: role hierarchy'),
    t('4', '[joao] P0 espera: yes to resend the report'),
    t('5', '[d] P0 Next 16.3.8 to 16.4.2', 'in_progress', { state: 'andamento' }),
    t('6', '[e] P1 andamento: review', 'in_progress'),
    t('7', '[f] wrong tag', 'pending', { priority: 'P2', state: 'espera' }),
  ]
  const shape = groups(open).map((g) => `${g.state}: ${g.tasks.map((x) => x.id).join(' ')}`)
  expect(shape).toEqual(['andamento: 5 6', 'espera: 4 7', 'fila: 3 2', 'pending: 1'])
  const note = openTasksNote({ list: 'demerzel', open, when: 'start' }) ?? ''
  expect(note).toContain('andamento (2):\n#5 [in_progress] [d] P0 Next 16.3.8 to 16.4.2\n#6 [in_progress] [e] P1 andamento: review\nespera (2):')
  expect(note.endsWith('pending (1):\n#1 [pending] [a] no tag at all\nTaskGet shows a task in full. Keep the list current with TaskUpdate.')).toBe(true)
})

test('past 30 tasks the note cuts by priority and counts the rest', () => {
  const open: Task[] = Array.from({ length: 32 }, (_, i) => ({ id: String(i + 1), subject: `[a] P${i < 2 ? 2 : 0} fila: t${i + 1}`, description: '', status: 'pending' }))
  const note = openTasksNote({ list: 'demerzel', open, when: 'start' }) ?? ''
  expect(note).toContain('fila (32):\n#3 ')
  expect(note).not.toContain('#1 ')
  expect(note).toContain('... and 2 more: run TaskList.')
})

test('the notes list open tasks in id order and say nothing about an empty list', () => {
  const open = [
    { id: '2', subject: '[refactor] port main', description: '', status: 'in_progress' as const },
    { id: '10', subject: '[tcc] title', description: '', status: 'pending' as const },
  ]
  expect(openTasksNote({ list: 'demerzel', open: [], when: 'start' })).toBe(null)
  expect(openTasksNote({ list: 'demerzel', open, when: 'compaction' })).toContain('in_progress (1):\n#2 [in_progress] [refactor] port main\npending (1):\n#10 [pending] [tcc] title')
  expect(promptContext({ list: 'demerzel', open: [], archived: [], remind: false })).toBe(null)
  expect(promptContext({ list: 'demerzel', open: [], archived: [], remind: true })).toContain('becomes a task (TaskCreate) before any other work')
})

test('at start the open tasks go in as a note, and completed ones go to the archive and stay on disk', async ($, on) => {
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
  expect(s.removed).toEqual([])
  expect(s.files.has(`${LIST}/2.json`)).toBe(true)
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
  expect(changed).toMatchObject({ context: [expect.stringContaining('pending (2):\n#4 [pending] [docs] guide\n#5 [pending] [zippi] issue')] })
  s.files.set(`${LIST}/4.json`, task('4', '[docs] guide', 'completed'))
  const closed = await $.prompt.submit({ text: 'and now', wait: false, origin: { kind: 'composer' } })
  expect(closed).toMatchObject({ context: [expect.stringContaining('Completed and archived since the last prompt:\n#4 [docs] guide\nOpen tasks now:\npending (1):\n#5')] })
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
  expect(ctx).toEqual(['Open tasks now:\npending (1):\n#1 [pending] write tests'])
})

test('a task marked completed goes to the archive at once', async ($, on) => {
  const s = scene({ [`${LIST}/1.json`]: task('1', '[a] one', 'pending') })
  prepare(on, s, undefined, () => s.files.set(`${LIST}/1.json`, task('1', '[a] one', 'completed')))
  await $.session.start(start)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  expect(s.files.has(`${LIST}/1.json`)).toBe(true)
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

// The app's task panel folds the session's TaskCreate and TaskUpdate calls and never reads the files.
const use = (tool: string, input: Record<string, unknown>, text?: string) => ({ tool_use_id: `u${Math.random()}`, tool, input, text })

test('the panel is folded from the calls the way the app folds them', () => {
  const p = panelFromMessages([
    { role: 'assistant', toolUses: [use('TaskCreate', { subject: '[a] one' }, 'Task #1 created successfully: [a] one')] },
    { role: 'assistant', toolUses: [use('TaskUpdate', { taskId: '15', status: 'completed' })] },
    { role: 'assistant', toolUses: [use('TaskCreate', { subject: '[b] reused' }, 'Task #1 created successfully: [b] reused')] },
    { role: 'assistant', toolUses: [use('TaskCreate', { subject: '[c] failed' }, 'Error')] },
    { role: 'assistant', toolUses: [use('TaskCreate', { subject: '[d] gone' }, 'Task #2 created successfully: [d] gone'), use('TaskUpdate', { taskId: '2', status: 'deleted' })] },
  ])
  // An update with no create shows the bare id, and a create on an id the panel holds is dropped.
  expect(p).toEqual({ '1': { subject: '[a] one', status: 'pending' }, '15': { subject: '15', status: 'completed' } })
  expect(panelUpdate(p, { taskId: 1, subject: '[a] renamed' })).toEqual({ ...p, '1': { subject: '[a] renamed', status: 'pending' } })
})

test('a panel that drifted from the disk gets the TaskUpdate calls that bring it back', () => {
  const t = (id: string, subject: string, status: Task['status']): Task => ({ id, subject, description: '', status })
  const panel = {
    '1': { subject: '[next-cve] P0 Next', status: 'in_progress' },
    '15': { subject: '15', status: 'completed' },
    '17': { subject: '[tcc] old subject', status: 'in_progress' },
    '20': { subject: '[x] same', status: 'pending' },
  }
  const disk = [t('17', '[tcc] new subject', 'in_progress'), t('20', '[x] same', 'pending'), t('21', '[y] by a script', 'pending'), t('22', '[z] closed', 'completed')]
  expect(panelCalls({ panel, disk, expired: new Set(['22']) })).toEqual([
    { taskId: '1', status: 'deleted' },
    { taskId: '15', status: 'deleted' },
    { taskId: '22', status: 'deleted' },
    { taskId: '17', subject: '[tcc] new subject' },
    { taskId: '21', subject: '[y] by a script', status: 'pending' },
  ])
})

test('a task an outside script completed reaches the panel through the session', async ($, on) => {
  const s = scene({ [`${LIST}/3.json`]: task('3', '[agent] P1 work', 'in_progress') })
  prepare(on, s, undefined, (e) => {
    const id = Reflect.get(e as object, 'taskId')
    if (Reflect.get(e as object, 'tool') === 'TaskUpdate' && Reflect.get(e as object, 'status') === 'completed') s.files.set(`${LIST}/${id}.json`, task(String(id), '[agent] P1 work', 'completed'))
  })
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '', toolUses: [use('TaskUpdate', { taskId: '3', subject: '[agent] P1 work', status: 'in_progress' })] }] }))
  await $.session.start(start)
  // `agent stop` rewrites the file and never calls TaskUpdate.
  s.files.set(`${LIST}/3.json`, task('3', '[agent] P1 work', 'completed'))
  const r = await $.prompt.submit({ text: 'status?', wait: false, origin: { kind: 'bridge' } })
  expect(r).toMatchObject({ context: [expect.stringContaining('TaskUpdate {"taskId":"3","status":"completed"}')] })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' })
  const after = await $.prompt.submit({ text: 'and now?', wait: false, origin: { kind: 'bridge' } })
  expect(after).not.toMatchObject({ context: [expect.stringContaining('TaskUpdate {')] })
  // The completed task stays on disk, so Claude Code never hands its id out again.
  expect(s.files.has(`${LIST}/3.json`)).toBe(true)
  expect(s.removed).toEqual([])
})

test('a completed task leaves the panel and the list through TaskUpdate once it is old enough', { options: { keepCompletedHours: 1 } }, async ($, on) => {
  const s = scene({ [`${LIST}/4.json`]: task('4', '[a] done', 'completed') })
  const clock = prepare(on, s)
  on('session.messages', () => ({ value: [] }))
  await $.session.start(start)
  const early = await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'composer' } })
  expect(Reflect.get(early, 'context')).toEqual(['Task list "demerzel". ' + 'A new request from the user becomes a task (TaskCreate) before any other work, with its owner in the subject, such as "[owner] what was asked". Mark it completed only after the result was reported.' + '\nCompleted and archived since the last prompt:\n#4 [a] done'])
  await clock.advance(2 * 3600_000)
  const late = await $.prompt.submit({ text: 'y', wait: false, origin: { kind: 'composer' } })
  expect(late).toMatchObject({ context: [expect.stringContaining('TaskUpdate {"taskId":"4","status":"deleted"}')] })
})

test('at start the id mark is raised past every id the archive saw', async ($, on) => {
  const s = scene({
    [`${LIST}/2.json`]: task('2', '[a] open', 'pending'),
    [ARCHIVE]: JSON.stringify({ event: 'archived', list: 'demerzel', id: '39', subject: 'x' }) + '\n',
  })
  prepare(on, s)
  on('session.messages', () => ({ value: [] }))
  await $.session.start(start)
  expect(s.files.get(`${LIST}/.highwatermark`)).toBe('39')
})

test('after a compaction every id the conversation hides is resynced once', async ($, on) => {
  const s = scene({ [`${LIST}/2.json`]: task('2', '[a] open', 'in_progress'), [`${LIST}/.highwatermark`]: '3' })
  prepare(on, s)
  const summary = 'This session is being continued from a previous conversation that ran out of context.'
  on('session.messages', () => ({ value: [{ role: 'user', text: summary, toolUses: [] }] }))
  await $.session.start(start)
  const r = await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'bridge' } })
  const ctx = String(Reflect.get(r, 'context'))
  expect(ctx).toContain('TaskUpdate {"taskId":"1","status":"deleted"}\nTaskUpdate {"taskId":"3","status":"deleted"}\nTaskUpdate {"taskId":"2","subject":"[a] open","status":"in_progress"}')
  expect(isCompacted([{ role: 'user', text: 'hi' }])).toBe(false)
  expect(withUnknown({ '2': { subject: 'a', status: 'pending' } }, 2)).toEqual({ '1': { subject: '', status: '' }, '2': { subject: 'a', status: 'pending' } })
})
