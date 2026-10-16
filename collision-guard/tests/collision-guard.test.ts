import { expect, mock, test } from 'claude-code/testing'
import {
  DEFAULTS,
  dirOf,
  editedPath,
  editNote,
  type Entry,
  gitNote,
  gitTargets,
  hitsForPath,
  hitsInRepo,
  inScope,
  isChanged,
  isStale,
  liveOthers,
  options,
  parseEntry,
  parseStatus,
  slashed,
} from '../hooks/rules.ts'

const NOW = Date.parse('2026-10-08T13:00:00Z')
const MIN = 60_000
const HOME = '/home/u'
const REPO = '/home/u/app'

function other(edits: Entry['edits'], over: Partial<Entry> = {}): Entry {
  return { session: 'other-session-0001', cwd: REPO, startedAt: NOW - 60 * MIN, seenAt: NOW - MIN, ended: false, edits, ...over }
}

// --- the pure part ---

test('options fall back to their defaults', () => {
  expect(options({})).toEqual(DEFAULTS)
  expect(options({ git: 'note', windowMinutes: 10, expireHours: 2 })).toEqual({ git: 'note', windowMinutes: 10, expireHours: 2 })
  expect(options({ git: 'block', windowMinutes: -1, expireHours: 'x' })).toEqual(DEFAULTS)
})

test('an entry reads back from disk, and a broken one reads as null', () => {
  const e = other({ [`${REPO}/a.ts`]: { at: NOW, root: REPO } })
  expect(parseEntry(JSON.stringify(e))).toEqual(e)
  expect(parseEntry('{"session":')).toBeNull()
  expect(parseEntry('[]')).toBeNull()
})

test('the edit tools name the file they write', () => {
  expect(editedPath('Edit', { file_path: '/a/b.ts' })).toBe('/a/b.ts')
  expect(editedPath('Write', { file_path: '/a/c.md' })).toBe('/a/c.md')
  expect(editedPath('NotebookEdit', { notebook_path: '/a/n.ipynb' })).toBe('/a/n.ipynb')
  expect(editedPath('Read', { file_path: '/a/b.ts' })).toBeNull()
  expect(editedPath('Edit', { file_path: 'relative.ts' })).toBeNull()
})

test('only live other sessions count, and old entries are stale', () => {
  const mine = other({}, { session: 'mine' })
  const ended = other({}, { session: 'ended', ended: true })
  const quiet = other({}, { session: 'quiet', seenAt: NOW - 25 * 60 * MIN })
  const live = other({})
  expect(liveOthers([mine, ended, quiet, live], 'mine', NOW, DEFAULTS).map((e) => e.session)).toEqual([live.session])
  expect(isStale(quiet, NOW, DEFAULTS)).toBe(true)
  expect(isStale(live, NOW, DEFAULTS)).toBe(false)
  expect(isStale({ ...ended, seenAt: NOW - 2 * 60 * MIN }, NOW, DEFAULTS)).toBe(true)
})

test('an edit outside git counts within the window, one inside a repo always (git decides)', () => {
  const o = other({ '/tmp/notes.md': { at: NOW - 40 * MIN, root: null }, '/srv/x.md': { at: NOW - 5 * MIN, root: null }, [`${REPO}/a.ts`]: { at: NOW - 300 * MIN, root: REPO } })
  expect(hitsForPath('/tmp/notes.md', [o], NOW, DEFAULTS)).toEqual([])
  expect(hitsForPath('/srv/x.md', [o], NOW, DEFAULTS)).toHaveLength(1)
  expect(hitsForPath(`${REPO}/a.ts`, [o], NOW, DEFAULTS)).toHaveLength(1)
  expect(hitsInRepo(REPO, [o]).map((h) => h.path)).toEqual([`${REPO}/a.ts`])
})

test('git status: changed paths, renames, and a match through a linked folder', () => {
  const changed = parseStatus(' M src/a.ts\0?? new.md\0R  b2.ts\0b.ts\0')
  expect([...changed]).toEqual(['src/a.ts', 'new.md', 'b2.ts', 'b.ts'])
  expect(isChanged('/link/app/src/a.ts', changed)).toBe(true)
  expect(isChanged('/home/u/app/src/aa.ts', changed)).toBe(false)
})

test('the git commands that touch other edits are found, with their folder', () => {
  const ops = (line: string) => gitTargets(line, REPO, HOME).map((t) => `${t.op}@${t.dir}`)
  expect(ops('git add -A')).toEqual([`stage-all@${REPO}`])
  expect(ops('git add .  && git commit -m "a; b && c"')).toEqual([`stage-all@${REPO}`])
  expect(ops('git add src/a.ts && git commit -m x')).toEqual([])
  expect(ops('git commit -am "fix"')).toEqual([`commit-all@${REPO}`])
  expect(ops('cd ~/other && git stash')).toEqual(['stash@/home/u/other'])
  expect(ops('git stash list')).toEqual([])
  expect(ops('git -C ../lib checkout main')).toEqual(['switch@/home/u/lib'])
  expect(ops('git checkout -- src/a.ts')).toEqual([`discard@${REPO}`])
  expect(ops('git restore --staged a.ts')).toEqual([])
  expect(ops('git reset --hard HEAD~1')).toEqual([`discard@${REPO}`])
  expect(ops('git reset HEAD a.ts')).toEqual([])
  expect(ops('git clean -fd')).toEqual([`clean@${REPO}`])
  expect(ops('GIT_PAGER=cat git status && git log')).toEqual([])
  expect(ops('echo "git add -A"')).toEqual([])
})

test('a git command limited to paths only touches the edits under them', () => {
  const scope = (line: string) => gitTargets(line, REPO, HOME).map((t) => t.scope)
  expect(scope('git add -A mods/')).toEqual([[`${REPO}/mods`]])
  expect(scope('git add -A')).toEqual([null])
  expect(scope('git add .')).toEqual([[REPO]])
  expect(scope('cd sub && git add -u .')).toEqual([[`${REPO}/sub`]])
  expect(scope('git add -A :/')).toEqual([null])
  expect(scope("git add -A 'src/*.ts'")).toEqual([null])
  expect(scope('git checkout -- src/a.ts')).toEqual([[`${REPO}/src/a.ts`]])
  expect(scope('git checkout main')).toEqual([null])
  expect(scope('git stash push -m wip -- lib')).toEqual([[`${REPO}/lib`]])
  expect(scope('git commit -am "fix" ')).toEqual([null])
  expect(inScope(`${REPO}/mods/a.ts`, [`${REPO}/mods`])).toBe(true)
  expect(inScope(`${REPO}/memorias/x.md`, [`${REPO}/mods`])).toBe(false)
  expect(inScope(`${REPO}/modsx/a.ts`, [`${REPO}/mods`])).toBe(false)
  expect(inScope(`${REPO}/anything`, null)).toBe(true)
})

test('the texts name the file, the session and how long ago', () => {
  const hits = hitsForPath(`${REPO}/a.ts`, [other({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } })], NOW, DEFAULTS)
  expect(editNote(`${REPO}/a.ts`, hits, NOW, HOME)).toBe(
    [
      'collision-guard: another Claude Code session also edited ~/app/a.ts, and its change is not committed:',
      '- session other-se in ~/app, edited 4 min ago',
      'Read the file again before building on your version of it, and tell the user both sessions are working on it.',
    ].join('\n'),
  )
  const [t] = gitTargets('git add -A', REPO, HOME)
  if (t === undefined) throw new Error('no target')
  expect(gitNote(t, hits, NOW, HOME, 'confirm')).toContain('Nothing ran. Name your own files instead, or run the same command again within 2 minutes')
  expect(gitNote(t, hits, NOW, HOME, 'confirm')).toContain('- ~/app/a.ts (session other-se in ~/app, edited 4 min ago)')
})

// --- the hooks, with another session's entry on disk ---

type Scene = {
  files: Map<string, string>
  ran: string[]
  toasts: string[]
  // What `git status` prints for the repo.
  status: string
}

const DIR = `${HOME}/.local/state/mods/collision-guard/sessions`

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('session.id', () => ({ value: 'this-session-0002' }))
  on('session.cwd', () => ({ value: REPO }))
  on('fs.read', ($, e) => {
    const text = s.files.get(e.path)
    return text === undefined ? { deny: 'no file' } : { value: text }
  })
  on('fs.write', ($, e) => {
    s.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...s.files.keys()].filter((p) => p.startsWith(`${e.path}/`)).map((p) => ({ name: p.slice(e.path.length + 1), kind: 'file' as const })),
  }))
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    s.ran.push(argv)
    if (argv.includes('rev-parse')) return { value: { exitCode: argv.includes('/tmp') ? 128 : 0, stdout: argv.includes('/tmp') ? '' : `${REPO}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv.includes(' status ')) return { value: { exitCode: 0, stdout: s.status, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    s.toasts.push(String(Reflect.get(e, 'text')))
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: REPO }))
  on('session.end', () => ({ sessionId: 'this-session-0002' }))
  on('turn.start', () => ({}))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  return clock
}

const start = { surface: 'terminal', isInteractive: true, cwd: REPO } as const

function scene(otherEdits: Entry['edits'], status = ' M a.ts\0'): Scene {
  const files = new Map<string, string>([[`${DIR}/other-session-0001.json`, JSON.stringify(other(otherEdits))]])
  return { files, ran: [], toasts: [], status }
}

test('an edit to a file the other session changed gets a note and a toast, once', async ($, on) => {
  const s = scene({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } })
  prepare(on, s)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Edit', file_path: `${REPO}/a.ts`, old_string: 'a', new_string: 'b' })
  expect(r).toMatchObject({ context: [expect.stringContaining('also edited ~/app/a.ts')] })
  expect(s.toasts).toEqual(['collision-guard: ~/app/a.ts was also edited by session other-se in ~/app, 4 min ago'])
  const again = await $.tool.call({ tool: 'Edit', file_path: `${REPO}/a.ts`, old_string: 'b', new_string: 'c' })
  expect(again).not.toHaveProperty('context')
  // This session's own entry now lists the file.
  const mine = parseEntry(s.files.get(`${DIR}/this-session-0002.json`) ?? '')
  expect(Object.keys(mine?.edits ?? {})).toEqual([`${REPO}/a.ts`])
})

test('no note when git shows the other edit as committed, or another file was edited', async ($, on) => {
  const s = scene({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } }, '')
  prepare(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Edit', file_path: `${REPO}/a.ts`, old_string: 'a', new_string: 'b' })).not.toHaveProperty('context')
  expect(await $.tool.call({ tool: 'Write', file_path: `${REPO}/b.ts`, content: 'x' })).not.toHaveProperty('context')
  expect(s.toasts).toEqual([])
})

test('git add -A is held once, listing the other session files, and runs when repeated', async ($, on) => {
  const s = scene({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } })
  prepare(on, s)
  await $.session.start(start)
  const first = await $.tool.call({ tool: 'Bash', command: 'git add -A' })
  expect(first).toMatchObject({ deny: expect.stringContaining('`git add -A` would stage them along with your own') })
  expect(s.toasts).toEqual(['collision-guard: held `git add -A`, 1 uncommitted file from 1 other session'])
  const second = await $.tool.call({ tool: 'Bash', command: 'git add -A' })
  expect(second).toMatchObject({ result: 'ok' })
})

test('a git command through PowerShell, as on Windows without Git Bash, is held the same way', async ($, on) => {
  const s = scene({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } })
  prepare(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'PowerShell', command: 'git add -A' } as never)).toMatchObject({ deny: expect.stringContaining('`git add -A` would stage them') })
})

test('a held command runs after 2 minutes only once confirmed again', async ($, on) => {
  const s = scene({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } })
  const clock = prepare(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'git stash' })).toHaveProperty('deny')
  await clock.advance(3 * MIN)
  expect(await $.tool.call({ tool: 'Bash', command: 'git stash' })).toHaveProperty('deny')
})

test('note mode lets the command run and tells the agent', { options: { git: 'note' } }, async ($, on) => {
  const s = scene({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } })
  prepare(on, s)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -am wip' })
  expect(r).toMatchObject({ result: 'ok', context: [expect.stringContaining('The command ran.')] })
})

test('a git command with no other session edits runs untouched', async ($, on) => {
  const s = scene({})
  prepare(on, s)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'git add -A' })).toMatchObject({ result: 'ok' })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'ok' })
  expect(s.toasts).toEqual([])
})

test('the session end marks the entry ended and writes one summary line', async ($, on) => {
  const s = scene({ [`${REPO}/a.ts`]: { at: NOW - 4 * MIN, root: REPO } })
  prepare(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Edit', file_path: `${REPO}/a.ts`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'git add -A' })
  await $.session.end({ reason: 'other', sessionId: 'this-session-0002', resume: { id: 'this-session-0002' } })
  expect(parseEntry(s.files.get(`${DIR}/this-session-0002.json`) ?? '')?.ended).toBe(true)
  const diary = (s.files.get(`${HOME}/.local/state/mods/collision-guard/2026-10-08-this-ses.jsonl`) ?? '').trim().split('\n').map((l): unknown => JSON.parse(l))
  expect(diary.map((l) => (l as { event: string }).event)).toEqual(['edit-warned', 'git-held', 'session-summary'])
  expect(diary[2]).toMatchObject({ toolCalls: 2, actions: { 'edit-warned': 1, 'git-held': 1 } })
})

test('a Windows path keys the registry with forward slashes, as git prints it', () => {
  expect(editedPath('Edit', { file_path: 'C:\\w\\app\\a.ts' })).toBe('C:/w/app/a.ts')
  expect(editedPath('Edit', { file_path: 'app\\a.ts' })).toBeNull()
  expect(dirOf('C:/w/app/a.ts')).toBe('C:/w/app')
  expect(dirOf('C:/a.ts')).toBe('C:/')
  expect(dirOf('/a.ts')).toBe('/')
  expect(slashed('/home/u/a.ts')).toBe('/home/u/a.ts')
})

test('git commands on Windows resolve against the drive, and `..` stops at it', () => {
  const at = (line: string) => gitTargets(line, 'C:/w/app', 'C:/Users/u').map((t) => `${t.op}@${t.dir}`)
  expect(at('git add -A')).toEqual(['stage-all@C:/w/app'])
  expect(at('cd ..\\other && git stash')).toEqual(['stash@C:/w/other'])
  expect(at('git -C ../../../.. add .')).toEqual(['stage-all@C:/'])
  expect(at('cd ~/x && git add -A')).toEqual(['stage-all@C:/Users/u/x'])
  expect(gitTargets('git checkout -- src\\lib', 'C:/w/app', 'C:/Users/u')[0]?.scope).toEqual(['C:/w/app/src/lib'])
})

test('a stale entry is deleted with del when there is no rm, as on Windows', async ($, on) => {
  const s = scene({})
  s.files.set(`${DIR}/other-session-0001.json`, JSON.stringify(other({}, { ended: true, seenAt: NOW - 2 * 60 * MIN })))
  const ran: string[][] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: HOME })
  on('session.id', () => ({ value: 'this-session-0002' }))
  on('fs.read', ($, e) => {
    const text = s.files.get(e.path)
    return text === undefined ? { deny: 'no file' } : { value: text }
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', ($, e) => ({
    value: [...s.files.keys()].filter((p) => p.startsWith(`${e.path}/`)).map((p) => ({ name: p.slice(e.path.length + 1), kind: 'file' as const })),
  }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'rm') return { deny: 'ENOENT: rm' }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', () => ({ cwd: REPO }))
  await $.session.start(start)
  await clock.advance(1)
  expect(ran.map((a) => a.slice(0, a[0] === 'rm' ? 2 : 6).join(' '))).toEqual(['rm -f', 'cmd /d /c del /f /q'])
  expect(ran[1]?.at(-1)).toBe('\\home\\u\\.local\\state\\mods\\collision-guard\\sessions\\other-session-0001.json')
})
