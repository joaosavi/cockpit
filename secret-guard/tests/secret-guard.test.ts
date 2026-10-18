import { expect, mock, test } from 'claude-code/testing'
import { accepts, buildTable, candidates, SECRETS_MIN_LENGTH, expandHome, fillCommand, findArgs, parseFind, type Found, options, redactedNotice, redactText } from '../hooks/rules.ts'

// Every secret here is fake and assembled at run time, so no file of the mod holds a string that looks
// like a real token, and the tests never touch the real filesystem or environment.
const FAKE_GH = 'ghp_' + 'Test00'.repeat(6)
const FAKE_AUTH = 'fake-session-secret-' + 'x'.repeat(40)
const FAKE_PG = 'fake-db-password-123'
const FAKE_BI = 'fake-bi-password-4567'
const FAKE_NEW = 'fake-token-that-came-later'
const PUBLISHED = 'password-published-in-example'
const FAKE_API = 'FakePanelTokenWithoutSeparator0123456789'
// `p@ss/word:xyz-fake` written in a URL, where it must be percent-encoded.
const FAKE_ENCODED = 'p%40ss%2Fword%3Axyz-fake'
const FAKE_DECODED = 'p@ss/word:xyz-fake'
const OTHER_GH = 'ghp_' + 'Other1'.repeat(6)
const FAKE_ANTHROPIC = 'sk-' + 'ant-' + 'fake' + 'A'.repeat(24)
const FAKE_AWS = 'AK' + 'IA' + 'FAKE' + '0'.repeat(12)
const FAKE_SLACK = 'xo' + 'xb-' + 'fake-1234567890'
const SHORT = 'short-pw'

const HOME = '/home/u'
const SECRETS = `${HOME}/.secrets`
const ROOT = `${HOME}/repos`
// The env root is off by default; most cases set it to the folder holding the repos.
const REPOS = { options: { envRoot: '~/repos' } }
const ENV_BI = `${ROOT}/bi/apps/bi/.env`
const EXAMPLE = `${ROOT}/bi/.env.example`
const NOTES = `${ROOT}/bi/notes.md`
const START = 1_000_000_000

const ALL_FAKES = [FAKE_GH, FAKE_AUTH, FAKE_PG, FAKE_BI, FAKE_API, FAKE_ENCODED, FAKE_DECODED, FAKE_NEW]
const leaks = (s: string) => ALL_FAKES.filter((v) => s.includes(v))

type FakeFile = { text: string; mtimeMs: number }
type ToolAnswer = { result: unknown; text?: string } | { isError: true; result: unknown; text: string }
type World = {
  files: Map<string, FakeFile>
  environ: Record<string, string>
  // The inputs each tool call reached core with, after the mod's hook.
  calls: Record<string, unknown>[]
  answers: ToolAnswer[]
  // What each tool call does while it runs, in order; a missing one does nothing.
  effects: Array<() => void>
  writes: Map<string, string>
  // Milliseconds each fs.stat takes, moved on the mock clock, to stand for a slow disk.
  statMs?: number
  // A folder's mtime, which moves when a file is created in it. Folders not listed are at 0.
  dirMtimes: Map<string, number>
  // How many fs.list and fs.stat calls the mod made.
  lists: number
  stats: number
  // No /proc, as on macOS and Windows; the environment comes from these commands instead.
  noProc?: { env0: boolean; set: boolean }
  ran?: string[]
}

function envBi(extra = ''): string {
  return [
    `BETTER_AUTH_SECRET=${FAKE_AUTH}`,
    'BETTER_AUTH_URL=http://localhost:3000',
    'PORT=3000',
    `DATABASE_URL=postgres://bi:${FAKE_BI}@127.0.0.1:5432/bi`,
    `WAREHOUSE_DATABASE_URL=postgres://w:${PUBLISHED}@localhost/w`,
    `PANEL_TOKEN=7|${FAKE_API}`,
    `ENCODED_URL=postgres://e:${FAKE_ENCODED}@db/e`,
    `SHORT_TOKEN=${SHORT}`,
    extra,
  ].join('\n')
}

function freshWorld(): World {
  return {
    files: new Map([
      [SECRETS, { text: `# fake\nexport GITHUB_TOKEN=${FAKE_GH}\nexport BI_MCP_PG_URL=postgres://mcp:${FAKE_PG}@db:5432/x\n`, mtimeMs: 0 }],
      [ENV_BI, { text: envBi(), mtimeMs: 0 }],
      [EXAMPLE, { text: `WAREHOUSE_DATABASE_URL=postgres://w:${PUBLISHED}@localhost/w\n`, mtimeMs: 0 }],
      [NOTES, { text: '# notes\n', mtimeMs: 0 }],
      [`${ROOT}/bi/node_modules/pkg/.env`, { text: `NODE_MODULES_TOKEN=${'n'.repeat(30)}\n`, mtimeMs: 0 }],
    ]),
    environ: { HOME, PATH: '/usr/bin:/bin', GITHUB_TOKEN: FAKE_GH, LANG: 'C.UTF-8' },
    calls: [],
    answers: [],
    effects: [],
    writes: new Map(),
    dirMtimes: new Map(),
    lists: 0,
    stats: 0,
  }
}

function isDir(w: World, path: string): boolean {
  const prefix = path.endsWith('/') ? path : path + '/'
  for (const f of w.files.keys()) if (f.startsWith(prefix)) return true
  return false
}

function setup(on: Parameters<Parameters<typeof test>[1]>[1], w: World) {
  const clock = mock.clock(on, { now: START })
  mock.env(on, { HOME })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('fs.read', ($, e) => {
    if (e.path === '/proc/self/environ' && w.noProc !== undefined) return { deny: 'ENOENT' }
    if (e.path === '/proc/self/environ') return { value: Object.entries(w.environ).map(([k, v]) => `${k}=${v}`).join('\0') + '\0' }
    const written = w.writes.get(e.path)
    if (written !== undefined) return { value: written }
    const f = w.files.get(e.path)
    return f === undefined ? { deny: 'ENOENT' } : { value: f.text }
  })
  on('fs.write', ($, e) => {
    w.writes.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    w.lists += 1
    if (!isDir(w, e.path)) return { deny: 'ENOTDIR' }
    const prefix = e.path + '/'
    const names = new Map<string, 'file' | 'dir'>()
    for (const f of w.files.keys()) {
      if (!f.startsWith(prefix)) continue
      const rest = f.slice(prefix.length)
      const slash = rest.indexOf('/')
      names.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'dir')
    }
    return { value: [...names].sort().map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.stat', async ($, e) => {
    w.stats += 1
    if (w.statMs !== undefined) await clock.advance(w.statMs)
    const f = w.files.get(e.path)
    const realPath = e.resolve ? e.path : undefined
    if (f !== undefined) return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false, realPath } }
    if (isDir(w, e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: w.dirMtimes.get(e.path) ?? 0, isLink: false, realPath } }
    return { deny: 'ENOENT' }
  })
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    w.ran?.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv === 'env -0' && w.noProc?.env0 === true) return ok(Object.entries(w.environ).map(([k, v]) => `${k}=${v}\0`).join(''))
    if (argv === 'cmd /d /c set' && w.noProc?.set === true) return ok(Object.entries(w.environ).map(([k, v]) => `${k}=${v}\r\n`).join(''))
    return { deny: 'ENOENT' }
  })
  on('tool.call', ($, e) => {
    w.calls.push({ ...e })
    w.effects.shift()?.()
    return w.answers.shift() ?? { result: 'ok', text: 'ok' }
  })
  return clock
}

function bash(stdout: string): ToolAnswer {
  return { result: { stdout, stderr: '', interrupted: false }, text: stdout }
}

function stdoutOf(r: unknown): string {
  const result: unknown = typeof r === 'object' && r !== null ? Reflect.get(r, 'result') : undefined
  const out: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, 'stdout') : undefined
  return typeof out === 'string' ? out : ''
}

function dump(r: unknown): string {
  return JSON.stringify(r)
}

// --- the cases of the Perl hook's self-test --------------------------------------------------------------

test('env output hides the environment token', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`HOME=${HOME}\nGITHUB_TOKEN=${FAKE_GH}\nLANG=C.UTF-8\n`))
  setup(on, w)
  const r = await $.tool.call({ tool: 'Bash', command: 'env' })
  expect(leaks(dump(r))).toEqual([])
  expect(stdoutOf(r)).toMatch(/^GITHUB_TOKEN=<hidden:GITHUB_TOKEN>$/m)
})

for (const [system, noProc] of [['macOS', { env0: true, set: false }], ['Windows', { env0: false, set: true }]] as const) {
  test(`without /proc, as on ${system}, the environment still comes in`, REPOS, async ($, on) => {
    const w = freshWorld()
    const only = 'e'.repeat(12) + 'nv-only-token-value'
    const askpass = 'C:\\Program Files\\Git\\mingw64\\bin\\git-askpass.exe'
    w.environ = { ...w.environ, ONLY_ENV_TOKEN: only, GIT_ASKPASS: askpass }
    w.noProc = noProc
    w.ran = []
    w.answers.push(bash(`ONLY_ENV_TOKEN=${only}\nGIT_ASKPASS=${askpass}\n`))
    setup(on, w)
    const r = await $.tool.call({ tool: 'Bash', command: 'env' })
    expect(stdoutOf(r)).toBe(`ONLY_ENV_TOKEN=<hidden:ONLY_ENV_TOKEN>\nGIT_ASKPASS=${askpass}\n`)
    expect(w.ran.filter((a) => !a.startsWith('find'))).toEqual(noProc.env0 ? ['env -0'] : ['env -0', 'env', 'cmd /d /c set'])
  })
}

test('printenv output hides the environment token', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`GITHUB_TOKEN=${FAKE_GH}\n`))
  setup(on, w)
  const r = await $.tool.call({ tool: 'Bash', command: 'printenv' })
  expect(stdoutOf(r)).toBe('GITHUB_TOKEN=<hidden:GITHUB_TOKEN>\n')
})

test('cat of a .env hides the secret and the URL password', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(envBi()))
  setup(on, w)
  const s = stdoutOf(await $.tool.call({ tool: 'Bash', command: `cat ${ENV_BI}` }))
  expect(leaks(s)).toEqual([])
  expect(s).toMatch(/^BETTER_AUTH_SECRET=<hidden:BETTER_AUTH_SECRET>$/m)
  expect(s).toMatch(/^DATABASE_URL=postgres:\/\/bi:<hidden:DATABASE_URL>@127\.0\.0\.1/m)
})

test('cat of a .env leaves what is not a secret, and the value published in .env.example', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(envBi()))
  setup(on, w)
  const s = stdoutOf(await $.tool.call({ tool: 'Bash', command: `cat ${ENV_BI}` }))
  expect(s).toMatch(/^BETTER_AUTH_URL=http:\/\/localhost:3000$/m)
  expect(s).toMatch(/^PORT=3000$/m)
  expect(s).toContain(PUBLISHED)
})

test('reading the secrets file hides every value, whatever its name', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(w.files.get(SECRETS)?.text ?? ''))
  setup(on, w)
  const s = stdoutOf(await $.tool.call({ tool: 'Bash', command: `sed -n p ${SECRETS}` }))
  expect(leaks(s)).toEqual([])
  expect(s).toContain('<hidden:GITHUB_TOKEN>')
  expect(s).toContain('postgres://mcp:<hidden:BI_MCP_PG_URL>@db')
})

test('echo of the token prints only the placeholder', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(FAKE_GH + '\n'))
  setup(on, w)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'echo $GITHUB_TOKEN' }))).toBe('<hidden:GITHUB_TOKEN>\n')
})

test('the env | grep GIT of a subagent on 2026-10-02 is hidden too', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`GITHUB_TOKEN=${FAKE_GH}\n`))
  setup(on, w)
  const r = await $.tool.call({ tool: 'Bash', command: 'env | grep GIT', agentId: 'subagent-1' })
  expect(w.calls[0]).toMatchObject({ agentId: 'subagent-1' })
  expect(stdoutOf(r)).toBe('GITHUB_TOKEN=<hidden:GITHUB_TOKEN>\n')
})

test('the Read of a .env keeps the result shape and names what it hid', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push({ result: { type: 'text', file: { filePath: ENV_BI, content: `BETTER_AUTH_SECRET=${FAKE_AUTH}\n`, numLines: 1 } } })
  setup(on, w)
  const r = await $.tool.call({ tool: 'Read', file_path: ENV_BI })
  expect(r).toMatchObject({
    result: { type: 'text', file: { filePath: ENV_BI, content: 'BETTER_AUTH_SECRET=<hidden:BETTER_AUTH_SECRET>\n', numLines: 1 } },
    context: [expect.stringContaining('BETTER_AUTH_SECRET')],
  })
  expect(Reflect.get(r, 'ref')).toBeUndefined()
})

test('a failed command loading the .env does not leak the token piece in its error', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push({ isError: true, result: `zsh: command not found: ${FAKE_API}`, text: `Exit code 127\nzsh: command not found: ${FAKE_API}` })
  setup(on, w)
  const r = await $.tool.call({ tool: 'Bash', command: `set -a; . ${ENV_BI}` })
  expect(leaks(dump(r))).toEqual([])
  expect(r).toMatchObject({ deny: expect.stringContaining('zsh: command not found: <hidden:PANEL_TOKEN>') })
  expect(r).toMatchObject({ deny: expect.stringContaining('Exit code 127') })
})

test('the piece of the token after the | is hidden', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(FAKE_API + '\n'))
  setup(on, w)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: `grep PANEL ${ENV_BI} | cut -d'|' -f2` }))).toBe('<hidden:PANEL_TOKEN>\n')
})

test('a known token format is hidden even when it is in no list', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`${OTHER_GH} ${FAKE_ANTHROPIC} ${FAKE_AWS} ${FAKE_SLACK}\n`))
  setup(on, w)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'echo tokens' }))).toBe('<hidden:github> <hidden:anthropic> <hidden:aws> <hidden:slack>\n')
})

test('an output without a secret passes as it came, the same object', REPOS, async ($, on) => {
  const w = freshWorld()
  const answer = { result: { type: 'text', file: { content: 'PORT=3000' } }, text: 'PORT=3000' }
  w.answers.push(answer)
  setup(on, w)
  const r = await $.tool.call({ tool: 'Read', file_path: NOTES })
  expect(r).toEqual(answer)
  expect(Reflect.get(r, 'context')).toBeUndefined()
})

test('in an MCP result the list of blocks keeps its shape', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push({ result: [{ type: 'text', text: `url ${FAKE_GH}` }] })
  setup(on, w)
  const r = await $.tool.call({ tool: 'mcp__database__query', sql: 'select 1' })
  expect(r).toMatchObject({ result: [{ type: 'text', text: 'url <hidden:GITHUB_TOKEN>' }] })
})

test('an Edit of a .env gets back the hidden value, in both placeholder spellings', REPOS, async ($, on) => {
  const w = freshWorld()
  setup(on, w)
  const r = await $.tool.call({
    tool: 'Edit',
    file_path: ENV_BI,
    old_string: 'BETTER_AUTH_SECRET=<hidden:BETTER_AUTH_SECRET>',
    new_string: 'BETTER_AUTH_SECRET=<hidden:BETTER_AUTH_SECRET>\nCOPY=<oculto:BETTER_AUTH_SECRET>\nOTHER=<hidden:UNKNOWN_NAME>',
  })
  expect(w.calls[0]).toMatchObject({
    file_path: ENV_BI,
    old_string: `BETTER_AUTH_SECRET=${FAKE_AUTH}`,
    new_string: `BETTER_AUTH_SECRET=${FAKE_AUTH}\nCOPY=${FAKE_AUTH}\nOTHER=<hidden:UNKNOWN_NAME>`,
  })
  expect(r).toMatchObject({ context: [expect.stringContaining('real value')] })
})

test('a Write of a .env restores the whole token and the URL password as written', REPOS, async ($, on) => {
  const w = freshWorld()
  setup(on, w)
  await $.tool.call({ tool: 'Write', file_path: ENV_BI, content: 'PANEL_TOKEN=<hidden:PANEL_TOKEN>\nDATABASE_URL=postgres://bi:<hidden:DATABASE_URL>@h/bi\nGH=<hidden:GITHUB_TOKEN>' })
  expect(w.calls[0]).toMatchObject({ content: `PANEL_TOKEN=7|${FAKE_API}\nDATABASE_URL=postgres://bi:${FAKE_BI}@h/bi\nGH=${FAKE_GH}` })
})

test('an Edit of a normal file restores nothing', REPOS, async ($, on) => {
  const w = freshWorld()
  setup(on, w)
  const r = await $.tool.call({ tool: 'Edit', file_path: NOTES, old_string: '# notes', new_string: 'COPY=<hidden:BETTER_AUTH_SECRET>' })
  expect(w.calls[0]).toMatchObject({ new_string: 'COPY=<hidden:BETTER_AUTH_SECRET>' })
  expect(Reflect.get(r, 'context')).toBeUndefined()
})

test('the list is rebuilt when a .env changes', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('first'), bash(envBi(`NEW_TOKEN=${FAKE_NEW}`)))
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(2000)
  w.files.set(ENV_BI, { text: envBi(`NEW_TOKEN=${FAKE_NEW}`), mtimeMs: clock.now() })
  const s = stdoutOf(await $.tool.call({ tool: 'Bash', command: `cat ${ENV_BI}` }))
  expect(s).not.toContain(FAKE_NEW)
  expect(s).toContain('<hidden:NEW_TOKEN>')
})

// --- beyond the Perl hook's self-test --------------------------------------------------------------

test('a value the tool itself just wrote to a .env is hidden in that same result', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('warm-up'), bash(`NEW_TOKEN=${FAKE_NEW}\n`))
  const clock = setup(on, w)
  // The second call writes the file while it runs, as a Bash `echo >> .env` would.
  w.effects.push(() => undefined, () => w.files.set(ENV_BI, { text: envBi(`NEW_TOKEN=${FAKE_NEW}`), mtimeMs: clock.now() }))
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  const s = stdoutOf(await $.tool.call({ tool: 'Bash', command: `echo NEW_TOKEN=... >> ${ENV_BI}; cat ${ENV_BI}` }))
  expect(s).toBe('NEW_TOKEN=<hidden:NEW_TOKEN>\n')
})

test('the list is rebuilt after 10 minutes even when no watched source changed', REPOS, async ($, on) => {
  const w = freshWorld()
  const deep = `${ROOT}/a/b/c/d/e/.env`
  w.answers.push(bash('first'), bash(`DEEP_TOKEN=${'d'.repeat(20)}\n`), bash(`DEEP_TOKEN=${'d'.repeat(20)}\n`))
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  // A file in a folder whose mtime is not watched: the stub leaves every folder's mtime at 0.
  w.files.set(deep, { text: `DEEP_TOKEN=${'d'.repeat(20)}\n`, mtimeMs: 0 })
  await clock.advance(60_000)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: `cat ${deep}` }))).toContain('d'.repeat(20))
  await clock.advance(10 * 60_000)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: `cat ${deep}` }))).toBe('DEEP_TOKEN=<hidden:DEEP_TOKEN>\n')
})

test('the URL password is hidden as written and URL-decoded', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`raw ${FAKE_ENCODED}\ndecoded ${FAKE_DECODED}\n`))
  setup(on, w)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'x' }))).toBe('raw <hidden:ENCODED_URL>\ndecoded <hidden:ENCODED_URL>\n')
})

test('a value shorter than the minimum length is left alone', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`SHORT_TOKEN=${SHORT}\n`))
  setup(on, w)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'x' }))).toBe(`SHORT_TOKEN=${SHORT}\n`)
})

test('a .env under node_modules is not read', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('n'.repeat(30)))
  setup(on, w)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'x' }))).toBe('n'.repeat(30))
})

test('secrets nested deep in an MCP result are hidden, and other fields kept', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push({ result: { rows: [{ id: 1, conf: { url: `postgres://bi:${FAKE_BI}@h/bi`, tags: ['a', FAKE_AUTH] }, ok: true }], count: 1 } })
  setup(on, w)
  const r = await $.tool.call({ tool: 'mcp__database__query', sql: 'select 1' })
  expect(r).toMatchObject({
    result: { rows: [{ id: 1, conf: { url: 'postgres://bi:<hidden:DATABASE_URL>@h/bi', tags: ['a', '<hidden:BETTER_AUTH_SECRET>'] }, ok: true }], count: 1 },
  })
})

test('the result of a subagent call itself is hidden', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push({ result: { content: [{ type: 'text', text: `found ${FAKE_GH}` }] } })
  setup(on, w)
  const r = await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'look', subagent_type: 'Explore' })
  expect(leaks(dump(r))).toEqual([])
  expect(dump(r)).toContain('found <hidden:GITHUB_TOKEN>')
})

test('the diary records names and counts, never a value', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`${FAKE_GH} ${FAKE_GH} ${FAKE_AUTH}`))
  setup(on, w)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: 'Bash', command: 'x' })
  const diary = [...w.writes].find(([p]) => p.includes('/.local/state/mods/secret-guard/'))
  expect(diary?.[0]).toMatch(/\/home\/u\/\.local\/state\/mods\/secret-guard\/\d{4}-\d\d-\d\d-abcdef12\.jsonl$/)
  const text = diary?.[1] ?? ''
  expect(leaks(text)).toEqual([])
  expect(text).toContain('"event":"redacted","tool":"Bash","names":["BETTER_AUTH_SECRET","GITHUB_TOKEN"],"count":3')
})

test('the rules: candidates, accepts, options', () => {
  expect(candidates('PANEL_TOKEN', `7|${FAKE_API}`, false)).toEqual([['PANEL_TOKEN', `7|${FAKE_API}`], ['PANEL_TOKEN', '7'], ['PANEL_TOKEN', FAKE_API]])
  expect(candidates('BETTER_AUTH_URL', 'http://localhost:3000', false)).toEqual([])
  expect(candidates('PLAIN', 'not-a-secret-name-value', false)).toEqual([])
  expect(candidates('PLAIN', 'not-a-secret-name-value', true)).toEqual([['PLAIN', 'not-a-secret-name-value']])
  expect(accepts('/an/absolute/path/value', 12)).toBe(false)
  expect(accepts('C:\\Users\\u\\AppData\\Local\\x', 12)).toBe(false)
  expect(accepts('D:/tools/askpass.exe', 12)).toBe(false)
  expect(accepts('${SOME_VARIABLE}', 12)).toBe(false)
  expect(accepts('<oculto:GITHUB_TOKEN>', 12)).toBe(false)
  expect(accepts('<hidden:GITHUB_TOKEN>', 12)).toBe(false)
  expect(accepts('long-enough-value', 12)).toBe(true)
  expect(options({ minLength: 8, secretsFile: '~/s' })).toEqual({ secretsFile: '~/s', envRoot: '', minLength: 8 })
  expect(options({ envRoot: ' ~/repos ' }).envRoot).toBe('~/repos')
  expect(expandHome('~/repos', HOME)).toBe(`${HOME}/repos`)
  const t = buildTable({ secrets: null, secretsDirFiles: [], envFiles: [], environ: [['SEGREDO_CACHE_TOKEN', 'ignored-perl-test-var'], ['API_KEY', 'env-api-key-value-fake']], minLength: 12 })
  expect([...t.nameOf]).toEqual([['env-api-key-value-fake', 'API_KEY']])
})

test('the session ends with one summary line: redactions, restores, and the time spent on stats', REPOS, async ($, on) => {
  const w = freshWorld()
  w.statMs = 2
  w.answers.push(bash(`GITHUB_TOKEN=${FAKE_GH}\n`), bash('nothing secret\n'))
  setup(on, w)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: 'Bash', command: 'env' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Edit', file_path: ENV_BI, old_string: 'BETTER_AUTH_SECRET=<hidden:BETTER_AUTH_SECRET>', new_string: 'BETTER_AUTH_SECRET=<hidden:BETTER_AUTH_SECRET>\nX=1' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const text = [...w.writes].find(([p]) => p.includes('/.local/state/mods/secret-guard/'))?.[1] ?? ''
  expect(leaks(text)).toEqual([])
  const lines = text.trim().split('\n').map((l): unknown => JSON.parse(l))
  const last = lines.at(-1)
  expect(last).toMatchObject({ event: 'session-summary', session: 'abcdef12', cwd: '/work', toolCalls: 3, actions: { redacted: 1, restored: 1 } })
  // Every fs.stat moved the clock 2 ms, and all of it is the hook's own time, outside the tool call.
  const hookMs: unknown = typeof last === 'object' && last !== null ? Reflect.get(last, 'hookMs') : 0
  const maxHookMs: unknown = typeof last === 'object' && last !== null ? Reflect.get(last, 'maxHookMs') : 0
  expect(typeof hookMs === 'number' && hookMs > 0 && hookMs % 2 === 0).toBe(true)
  expect(typeof maxHookMs === 'number' && typeof hookMs === 'number' && maxHookMs > 0 && maxHookMs <= hookMs).toBe(true)
  expect(lines.filter((l) => JSON.stringify(l).includes('session-summary')).length).toBe(1)
})

// --- the cost of the freshness check ---------------------------------------------------------------

test('a call with no source change lists no folder, and stats only the known source files', REPOS, async ($, on) => {
  const w = freshWorld()
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  const [lists, stats] = [w.lists, w.stats]
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(w.lists - lists).toBe(0)
  // ~/.secrets, ~/.secrets.d, bi/apps/bi/.env and bi/.env.example.
  expect(w.stats - stats).toBe(4)
})

test('a changed known file rebuilds the list on the next call, without a folder scan', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('first'), bash(`NEW_TOKEN=${FAKE_NEW}\n`))
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  w.files.set(ENV_BI, { text: envBi(`NEW_TOKEN=${FAKE_NEW}`), mtimeMs: clock.now() })
  const lists = w.lists
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'tail -1 notes' }))).toBe('NEW_TOKEN=<hidden:NEW_TOKEN>\n')
  expect(w.lists - lists).toBe(0)
})

// A new `.env` in bi/apps, a watched folder, whose mtime moves when the file is created.
const NEW_ENV = `${ROOT}/bi/apps/.env.local`

function createNewEnv(w: World, at: number) {
  w.files.set(NEW_ENV, { text: `LOCAL_TOKEN=${FAKE_NEW}\n`, mtimeMs: at })
  w.dirMtimes.set(`${ROOT}/bi/apps`, at)
}

test('a new .env is found by the folder check after 60 s, and not before', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('first'), bash(FAKE_NEW), bash(FAKE_NEW))
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  createNewEnv(w, clock.now())
  await clock.advance(29_000)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'ls' }))).toBe(FAKE_NEW)
  await clock.advance(31_000)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'ls' }))).toBe('<hidden:LOCAL_TOKEN>')
})

test('a Write to a new .env path is scanned right away, and its value hidden in that same result', REPOS, async ($, on) => {
  const w = freshWorld()
  const clock = setup(on, w)
  w.answers.push(bash('first'), { result: { type: 'create', filePath: NEW_ENV, content: `LOCAL_TOKEN=${FAKE_NEW}\n` } })
  w.effects.push(() => undefined, () => createNewEnv(w, clock.now()))
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  const r = await $.tool.call({ tool: 'Write', file_path: NEW_ENV, content: `LOCAL_TOKEN=${FAKE_NEW}\n` })
  expect(r).toMatchObject({ result: { content: 'LOCAL_TOKEN=<hidden:LOCAL_TOKEN>\n' } })
})

test('a Bash command that mentions .env checks the folders right away', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('first'), bash(`LOCAL_TOKEN=${FAKE_NEW}\n`))
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  createNewEnv(w, clock.now())
  await clock.advance(1000)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'cat bi/apps/.env.local' }))).toBe('LOCAL_TOKEN=<hidden:LOCAL_TOKEN>\n')
})

test('the redaction note names the secrets and tells the agent how to use the placeholder', () => {
  expect(redactedNotice(['API_KEY', 'DB_PASSWORD'])).toBe(
    'secret-guard: replaced the value of API_KEY, DB_PASSWORD in this output with <hidden:NAME>. ' +
      'Use the placeholder as is; written into a .env or secrets file, it becomes the real value. ' +
      'If you see the real value anywhere, tell the user API_KEY, DB_PASSWORD leaked into the transcript and must be rotated.',
  )
})

// --- without an env root ---

test('without an env root, no folder is listed and .env values stay visible, while the other sources are hidden', async ($, on) => {
  const w = freshWorld()
  const clock = setup(on, w)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  w.answers.push(bash(`${envBi()}\nGITHUB_TOKEN=${FAKE_GH}\nBI_MCP_PG_URL=postgres://mcp:${FAKE_PG}@db:5432/x\n${FAKE_SLACK}`))
  const r = await $.tool.call({ tool: 'Bash', command: `cat ${ENV_BI}; env` })
  const out = stdoutOf(r)
  expect(out).toContain(FAKE_AUTH)
  expect(out).toContain(FAKE_BI)
  expect(out).not.toContain(FAKE_GH)
  expect(out).not.toContain(FAKE_PG)
  expect(out).not.toContain(FAKE_SLACK)
  await clock.advance(61_000)
  await $.tool.call({ tool: 'Bash', command: 'cat .env' })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/new/.env`, content: 'A=1' })
  expect(w.lists).toBe(0)
})

test('the list is built in the background when the session starts, before any tool call', REPOS, async ($, on) => {
  const w = freshWorld()
  const clock = setup(on, w)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(w.lists).toBe(0)
  await clock.advance(1)
  // The build scanned the repos folder for .env files with no tool call yet.
  expect(w.lists > 0).toBe(true)
  expect(w.calls.length).toBe(0)
})

// --- token formats, and placeholders inside a command ---------------------------------------------------

const FAKE_OPENAI = 'sk-' + 'proj-' + 'Fake'.repeat(9)
const FAKE_GOOGLE = 'AI' + 'za' + 'Fake_'.repeat(7)
const FAKE_STRIPE = 'sk' + '_live_' + 'Fake0'.repeat(5)
const FAKE_JWT = 'ey' + 'J' + 'hbGciOiJIUzI1NiJ9' + '.' + 'ey' + 'J' + 'zdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'FakeSignature_0123456789'
const FAKE_PEM = '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIEfake\n-----END ' + 'RSA PRIVATE KEY-----'

test('the new token formats are hidden by kind, and a plain sk- word or a short eyJ is left alone', () => {
  const t = buildTable({ secrets: null, secretsDirFiles: [], envFiles: [], environ: [], minLength: 12 })
  const found: Found = new Map()
  const out = redactText([FAKE_OPENAI, FAKE_GOOGLE, FAKE_STRIPE, FAKE_JWT, FAKE_PEM, FAKE_ANTHROPIC].join('\n'), t, found)
  expect(out).toBe(['<hidden:openai>', '<hidden:google>', '<hidden:stripe>', '<hidden:jwt>', '<hidden:private-key>', '<hidden:anthropic>'].join('\n'))
  expect(redactText('use sk-learn and eyJhbGc in docs', t, new Map())).toBe('use sk-learn and eyJhbGc in docs')
})

test('a name with two different values is ambiguous, and a token known only by its format cannot be filled', () => {
  const t = buildTable({
    secrets: null,
    secretsDirFiles: [],
    envFiles: [{ path: '/a/.env', text: `API_TOKEN=${FAKE_AUTH}\n` }, { path: '/b/.env', text: `API_TOKEN=${FAKE_NEW}\nOTHER_TOKEN=${FAKE_API}\n` }],
    environ: [],
    minLength: 12,
  })
  expect([...t.ambiguous]).toEqual(['API_TOKEN'])
  expect(fillCommand('curl -H "X: <hidden:OTHER_TOKEN>" x', t)).toEqual({ command: `curl -H "X: ${FAKE_API}" x`, filled: ['OTHER_TOKEN'], unfilled: [] })
  expect(fillCommand('echo <hidden:API_TOKEN> <hidden:github>', t).unfilled).toEqual(['API_TOKEN', 'github'])
})

test('a Bash command with a placeholder runs with the real value, and its output is hidden again', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash(`authorized as ${FAKE_GH}\n`))
  setup(on, w)
  const r = await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: token <hidden:GITHUB_TOKEN>" api' })
  expect(w.calls[0]?.command).toBe(`curl -H "Authorization: token ${FAKE_GH}" api`)
  expect(stdoutOf(r)).toBe('authorized as <hidden:GITHUB_TOKEN>\n')
  expect(dump(r)).toContain('filled in the real value of GITHUB_TOKEN')
})

test('a Bash command that only searches for the placeholder text runs as written, with no fill notice', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('no match\n'))
  setup(on, w)
  const command = "grep -rn '<hidden:[A-Z_a-z0-9]*>' ."
  const r = await $.tool.call({ tool: 'Bash', command })
  expect(w.calls[0]?.command).toBe(command)
  expect(dump(r)).not.toContain('filled in the real value')
})

test('a Bash command with a placeholder the mod cannot fill does not run', REPOS, async ($, on) => {
  const w = freshWorld()
  setup(on, w)
  const r = await $.tool.call({ tool: 'Bash', command: 'echo <hidden:openai>' })
  expect(w.calls).toEqual([])
  expect(r).toMatchObject({ deny: expect.stringContaining('the value of openai is not known, only its format') })
})

test('the find scan keeps the .env files and the folders the walk watches, and skips the rest', () => {
  const out = ['0 d /r', '1 d /r/app', '1 f /r/.env', '2 f /r/app/.env.local', '3 d /r/a/b/c', '4 d /r/a/b/c/d', '2 l /r/app/.env.prod', '2 f /r/app/env.txt', '6 f /r/1/2/3/4/5/.env'].join('\n')
  expect(parseFind(out)).toEqual({
    files: ['/r/.env', '/r/app/.env.local', '/r/1/2/3/4/5/.env'],
    links: ['/r/app/.env.prod'],
    dirs: ['/r', '/r/app', '/r/a/b/c'],
  })
  const args = findArgs('/r')
  expect(args.slice(0, 4)).toEqual(['find', '/r', '-maxdepth', '6'])
  expect(args).toContain('node_modules')
})

// --- the secrets folder, where a tool such as a vault keeps its own list ------------------------------

const SECRETS_DIR = `${SECRETS}.d`
const VAULT = `${SECRETS_DIR}/vault`
// A vault password of 8 characters, under the 12 of `minLength`, a 5-character one under the folder's
// floor, and a value whose pieces are short.
const FAKE_VAULT_SHORT = 'fk8chars'
const FAKE_VAULT_TINY = 'fk5ch'
const FAKE_VAULT_PIECES = 'fake ab|cd vault'

test('a file in the secrets folder hides every value whatever its name, down to the folder floor', REPOS, async ($, on) => {
  const w = freshWorld()
  w.files.set(VAULT, { text: `SITE_EXAMPLE_COM="${FAKE_VAULT_SHORT}"\nPIN_ITEM="${FAKE_VAULT_TINY}"\nNOTE_ITEM="${FAKE_VAULT_PIECES}"\n`, mtimeMs: 0 })
  w.answers.push(bash(`login ${FAKE_VAULT_SHORT}\npin ${FAKE_VAULT_TINY}\nnote ${FAKE_VAULT_PIECES}\npiece ab\n`))
  setup(on, w)
  const s = stdoutOf(await $.tool.call({ tool: 'Bash', command: 'x' }))
  expect(FAKE_VAULT_TINY.length).toBeLessThan(SECRETS_MIN_LENGTH)
  expect(s).toBe(`login <hidden:SITE_EXAMPLE_COM>\npin ${FAKE_VAULT_TINY}\nnote <hidden:NOTE_ITEM>\npiece ab\n`)
})

test('a value under minLength stays visible when it comes from a .env, not from a secrets file', REPOS, async ($, on) => {
  const w = freshWorld()
  w.files.set(ENV_BI, { text: envBi(`OTHER_TOKEN=${FAKE_VAULT_SHORT}`), mtimeMs: 0 })
  w.answers.push(bash(FAKE_VAULT_SHORT))
  setup(on, w)
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'x' }))).toBe(FAKE_VAULT_SHORT)
})

test('a secrets folder that appears later is read on the next call, and a dot file in it is skipped', REPOS, async ($, on) => {
  const w = freshWorld()
  w.answers.push(bash('first'), bash(`${FAKE_VAULT_SHORT} ${FAKE_NEW}\n`))
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  w.files.set(VAULT, { text: `SITE_EXAMPLE_COM="${FAKE_VAULT_SHORT}"\n`, mtimeMs: clock.now() })
  w.files.set(`${SECRETS_DIR}/.vault.tmp`, { text: `HALF_WRITTEN="${FAKE_NEW}"\n`, mtimeMs: clock.now() })
  w.dirMtimes.set(SECRETS_DIR, clock.now())
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'vault names' }))).toBe(`<hidden:SITE_EXAMPLE_COM> ${FAKE_NEW}\n`)
})

test('a vault value rewritten in the secrets folder replaces the old one on the next call', REPOS, async ($, on) => {
  const w = freshWorld()
  const rotated = 'fake-rotated-pw'
  w.files.set(VAULT, { text: `SITE_EXAMPLE_COM="${FAKE_VAULT_SHORT}"\n`, mtimeMs: 0 })
  w.answers.push(bash('first'), bash(`${FAKE_VAULT_SHORT} ${rotated}\n`))
  const clock = setup(on, w)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.advance(1000)
  w.files.set(VAULT, { text: `SITE_EXAMPLE_COM="${rotated}"\n`, mtimeMs: clock.now() })
  expect(stdoutOf(await $.tool.call({ tool: 'Bash', command: 'x' }))).toBe(`${FAKE_VAULT_SHORT} <hidden:SITE_EXAMPLE_COM>\n`)
})
