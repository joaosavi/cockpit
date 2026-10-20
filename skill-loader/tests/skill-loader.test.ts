import { expect, mock, test } from 'claude-code/testing'
import { asSkill, bareSkill, byCommand, byTool, installPathOf, loadedText, looksLikeError, refusalText } from '../hooks/rules.ts'

test('each file calls for the right skill', () => {
  expect(byTool('Read', '/w/src/a.ts')?.skill).toBe('typescript-best-practices')
  expect(byTool('Edit', '/w/app/page.tsx')?.skill).toBe('typescript-best-practices')
  expect(byTool('Edit', '/w/.claude/skills/x/SKILL.md')?.skill).toBe('writing-for-agents')
  expect(byTool('Write', '/w/CLAUDE.md')?.skill).toBe('writing-for-agents')
  expect(byTool('Edit', '/w/CONTEXT.md')?.skill).toBe('domain-modeling')
  expect(byTool('Write', '/w/docs/adr/0003-currency.md')?.skill).toBe('domain-modeling')
  expect(byTool('Edit', '/w/README.md')?.skill).toBe('technical-writing')
  expect(byTool('Read', '/w/notes.md')).toBeNull()
  expect(byTool('Bash', '/w/a.ts')).toBeNull()
  expect(byTool('Read', '/tmp/x/bundled-skills/2.1.296/abc/plugin-authoring/types/claude-code.d.ts')).toBeNull()
  expect(byTool('Read', '/w/node_modules/zod/index.d.ts')).toBeNull()
  expect(byTool('Read', '/w/mod/.claude-plugin/types/claude-code/index.d.ts')).toBeNull()
})

test('a Windows path calls for the same skill as its forward-slash spelling', () => {
  expect(byTool('Edit', 'C:\\w\\.claude\\skills\\x\\SKILL.md')?.skill).toBe('writing-for-agents')
  expect(byTool('Write', 'C:\\w\\docs\\adr\\0003-currency.md')?.skill).toBe('domain-modeling')
  expect(byTool('Read', 'C:\\w\\node_modules\\zod\\index.d.ts')).toBeNull()
})

test('a SKILL.md with CRLF line ends loses its frontmatter too', () => {
  expect(asSkill('/s/x', '---\r\nname: x\r\ndescription: y\r\n---\r\n\r\n# Body\r\n')).toBe('Base directory for this skill: /s/x\n\n# Body')
})

test('the user\'s skills folder falls back to USERPROFILE when HOME is unset', async ($, on) => {
  const read: string[] = []
  mock.clock(on, { now: 0 })
  mock.env(on, { USERPROFILE: '/users/u' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.read', ($, e) => {
    read.push(e.path)
    return { deny: 'no file' }
  })
  on('fs.write', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
  expect(read).toContain('/users/u/.claude/skills/typescript-best-practices/SKILL.md')
})

test('commits and PRs call for technical-writing, and a quote does not', () => {
  expect(byCommand('git add -A && git commit -m "x"')?.skill).toBe('technical-writing')
  expect(byCommand('gh pr create --title t --body b')?.skill).toBe('technical-writing')
  expect(byCommand('git log --oneline')).toBeNull()
  expect(byCommand('echo "run git commit later"')).toBeNull()
})

test('recognizes a pasted error, "quebrou" and "is broken"', () => {
  expect(looksLikeError('TypeError: x is not a function\n    at f (a.js:1:2)')).toBe(true)
  expect(looksLikeError('o deploy quebrou de novo')).toBe(true)
  expect(looksLikeError('the deploy is broken again')).toBe(true)
  expect(looksLikeError('write the October report')).toBe(false)
  expect(looksLikeError('por remote control isso nao funciona? como fazemos funcionar?')).toBe(false)
  expect(looksLikeError('is it not working over SSH?')).toBe(false)
  expect(looksLikeError('o card nao funciona no celular')).toBe(true)
})

type Scenario = { read: string[]; calls: string[]; missing?: string[]; written?: string[] }

function setup(on: Parameters<Parameters<typeof test>[1]>[1], c: Scenario) {
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', ($, e) => {
    const m = /\/home\/\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(e.path)
    if (m?.[1] === undefined || c.missing?.includes(m[1])) return { deny: 'no file' }
    c.read.push(m[1])
    return { value: `---\nname: ${m[1]}\ndescription: x\n---\n\n# Body of ${m[1]}\n` }
  })
  on('fs.write', ($, e) => {
    c.written?.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('tool.call', ($, e) => {
    c.calls.push(e.tool)
    return { result: 'ok', text: 'ok' }
  })
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('reading a .ts delivers the skill along with the read, only once', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  expect(r).toMatchObject({ text: 'ok', context: [expect.stringContaining('# Body of typescript-best-practices')] })
  expect(r).toMatchObject({ context: [expect.stringContaining('Base directory for this skill: /home/.claude/skills/typescript-best-practices')] })
  expect(await $.tool.call({ tool: 'Read', file_path: '/w/b.ts' })).not.toMatchObject({ context: [expect.anything()] })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })).toMatchObject({ text: 'ok' })
  expect(c.read).toEqual(['typescript-best-practices'])
  expect(c.calls).toEqual(['Read', 'Read', 'Edit'])
})

test('writing without a prior read refuses once, with the skill in the refusal', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Write', file_path: '/w/new.ts', content: 'x' })
  expect(r).toMatchObject({ deny: expect.stringContaining('# Body of typescript-best-practices') })
  expect(await $.tool.call({ tool: 'Write', file_path: '/w/new.ts', content: 'x' })).toMatchObject({ text: 'ok' })
  expect(c.calls).toEqual(['Write'])
})

test('with holdWrites off, the write runs and the skill comes with its result', { options: { holdWrites: false } }, async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Write', file_path: '/w/new.ts', content: 'x' })
  expect(r).toMatchObject({ text: 'ok', context: [expect.stringContaining('# Body of typescript-best-practices')] })
  expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })).toMatchObject({ text: 'ok', context: [expect.stringContaining('# Body of technical-writing')] })
  expect(c.calls).toEqual(['Write', 'Bash'])
})

test('disabled, the mod delivers nothing and holds nothing', { options: { enabled: false } }, async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Write', file_path: '/w/new.ts', content: 'x' })).toMatchObject({ text: 'ok' })
  expect(c.read).toEqual([])
})

test('a commit without technical-writing refuses once, with the skill in the refusal', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })).toMatchObject({ deny: expect.stringContaining('# Body of technical-writing') })
  expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "y"' })).toMatchObject({ text: 'ok' })
})

test('a skill the agent loaded on its own does not come again', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Skill', skill: 'typescript-best-practices' })).toMatchObject({ text: 'ok' })
  await $.tool.call({ tool: 'Write', file_path: '/w/new.ts', content: 'x' })
  expect(c.read).toEqual([])
  expect(c.calls).toEqual(['Skill', 'Write'])
})

test('a skill missing from the machine does not block the write', async ($, on) => {
  const c = { read: [], calls: [], missing: ['writing-for-agents'] }
  setup(on, c)
  await $.session.start(start)
  expect(await $.tool.call({ tool: 'Edit', file_path: '/w/CLAUDE.md', old_string: 'a', new_string: 'b' })).toMatchObject({ text: 'ok' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/w/CLAUDE.md', old_string: 'a', new_string: 'b' })).toMatchObject({ text: 'ok' })
})

test('a subagent does not trigger skills', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'sub1' })
  expect(c.read).toEqual([])
})

test('/clear forgets the delivered skills', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  await $.session.end({ reason: 'clear' })
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  expect(c.read).toEqual(['typescript-best-practices', 'typescript-best-practices'])
})

test('an error pasted by the user gets the diagnosing-bugs reminder', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.prompt.submit({ text: 'TypeError: x is not a function', wait: false, origin: { kind: 'bridge' } })
  expect(r).toMatchObject({ context: [expect.stringContaining('diagnosing-bugs')] })
  const auto = await $.prompt.submit({ text: 'TypeError: x', wait: false, origin: { kind: 'scheduled-trigger' } })
  expect(auto).toMatchObject({ text: 'TypeError: x' })
  expect('context' in auto && auto.context !== undefined).toBe(false)
})

test('with diagnoseReminder off, a pasted error gets no reminder', { options: { diagnoseReminder: false } }, async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.prompt.submit({ text: 'TypeError: x is not a function', wait: false, origin: { kind: 'bridge' } })
  expect('context' in r && r.context !== undefined).toBe(false)
})

test('the agent asking again for a skill the mod delivered gets a short answer', async ($, on) => {
  const c = { read: [], calls: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  expect(await $.tool.call({ tool: 'Skill', skill: 'typescript-best-practices' })).toMatchObject({ deny: expect.stringContaining('already came in full') })
})

test('the session ends with one summary line: loads by skill, refusals and calls seen', async ($, on) => {
  const written: string[] = []
  const c = { read: [], calls: [], written }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  await $.tool.call({ tool: 'Write', file_path: '/w/CLAUDE.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/w/CLAUDE.md', content: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const last: unknown = JSON.parse(written.at(-1) ?? '{}')
  expect(last).toEqual({
    at: '1970-01-01T00:00:00.000Z',
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work',
    toolCalls: 4,
    actions: { 'loaded:typescript-best-practices': 1, 'loaded:writing-for-agents': 1, refused: 1 },
    hookMs: 0,
    maxHookMs: 0,
  })
})

test('the agent texts say what the mod did and what to do next', () => {
  // The note starts with `The skill <name>`, so the transcript says which skills a turn used.
  expect(loadedText('domain-modeling', 'BODY')).toBe('The skill domain-modeling follows in full, loaded by skill-loader. Follow it from here on.\n\nBODY')
  expect(refusalText('technical-writing', '/w/README.md', 'BODY')).toBe(
    'skill-loader: the technical-writing skill applies to /w/README.md and follows in full. Read it, then repeat the call following it.\n\nBODY',
  )
})

test('the install record gives the plugin folder, and a broken record gives none', () => {
  const record = JSON.stringify({ version: 2, plugins: { 'other@x': [{ installPath: '/o' }], 'skill-loader@cockpit': [{ installPath: '/cache/cockpit/skill-loader/1.2.0' }] } })
  expect(installPathOf(record, 'skill-loader')).toBe('/cache/cockpit/skill-loader/1.2.0')
  expect(installPathOf('{}', 'skill-loader')).toBeNull()
  expect(installPathOf('not json', 'skill-loader')).toBeNull()
})

test('the plugin\'s own copy of a skill comes before the user\'s', async ($, on) => {
  const read: string[] = []
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', ($, e) => {
    if (e.path === '/home/.claude/plugins/installed_plugins.json') return { value: JSON.stringify({ plugins: { 'skill-loader@cockpit': [{ installPath: '/plug' }] } }) }
    if (!e.path.endsWith('/SKILL.md')) return { deny: 'no file' }
    read.push(e.path)
    return { value: '---\nname: x\n---\n\n# Body\n' }
  })
  on('fs.write', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
  expect(read).toEqual(['/plug/skills/typescript-best-practices/SKILL.md'])
  expect(JSON.stringify(r)).toContain('Base directory for this skill: /plug/skills/typescript-best-practices')
})

test('a skill named with its plugin prefix counts as the bare skill', () => {
  expect(bareSkill('skill-loader:diagnosing-bugs')).toBe('diagnosing-bugs')
  expect(bareSkill('mattpocock-skills:diagnosing-bugs')).toBe('diagnosing-bugs')
  expect(bareSkill('diagnosing-bugs')).toBe('diagnosing-bugs')
})
