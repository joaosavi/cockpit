import { expect, mock, test } from 'claude-code/testing'
import { expandHome, globalDir, indexContent, metaProject, parseSection, rewriteSection, scopeOf, scopePath, wikiSection, withGlobalIndex } from '../hooks/rules.ts'
import { coreSection } from './core-section.ts'

const PROJECT = '/home/u/.claude/projects/-home-u-work/memory/'
const GLOBAL = '/home/u/.claude/global-memory'
const GLOBAL_INDEX = `${GLOBAL}/MEMORY.md`
const PROJECT_INDEX = `${PROJECT}MEMORY.md`

// The short section core sends on a lean prompt, with an invented folder.
const LEAN = [
  '# Memory',
  `You have a persistent file-based memory at \`${PROJECT}\`. This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence). Each memory is one file holding one fact, with frontmatter:`,
  'name: <short-kebab-case-slug>',
  'After writing the file, add a one-line pointer in `MEMORY.md` (`- [Title](file.md) — hook`).',
].join('\n')

test('reads the project folder and the mode from the opening sentence', () => {
  expect(parseSection(coreSection(PROJECT))).toMatchObject({ projectDir: PROJECT, mode: 'writable', isFull: true })
  expect(parseSection(coreSection(PROJECT, true))).toMatchObject({ projectDir: PROJECT, mode: 'read-only' })
  expect(parseSection(LEAN)).toMatchObject({ projectDir: PROJECT, mode: 'writable', isFull: false })
  expect(parseSection('# Memory\nSomething else entirely.')).toBeNull()
})

test('expands ~ with HOME and refuses ~ without it', () => {
  expect(expandHome('~/.claude/global-memory', '/home/u')).toBe(GLOBAL)
  expect(expandHome('/srv/memory', undefined)).toBe('/srv/memory')
  expect(expandHome('~/x', undefined)).toBeNull()
})

test('expands a Windows home and a ~\\ path, and trims either trailing separator', () => {
  expect(expandHome('~\\.claude\\memory', 'C:\\Users\\u\\')).toBe('C:\\Users\\u\\.claude\\memory')
  expect(expandHome('~/.claude/memory', 'C:\\Users\\u')).toBe('C:\\Users\\u/.claude/memory')
  expect(globalDir({ globalDir: 'D:\\memory\\' }, undefined)).toBe('D:\\memory')
})

test('the rewritten section keeps the project folder and adds the global one with the save rules', () => {
  const r = rewriteSection(coreSection(PROJECT), GLOBAL)
  expect(r?.mode).toBe('writable')
  const text = r?.text ?? ''
  expect(text).toContain(`a project directory at \`${PROJECT}\` and a machine-wide global directory at \`${GLOBAL}/\`. Both directories already exist`)
  expect(text).toContain('## Memory scope')
  expect(text).toContain('- `user` and `feedback`: default to global.')
  expect(text).toContain('- `reference`: global when it is about the machine, its tools, access or services')
  expect(text).toContain('- `project`: always the project directory.')
  expect(text).toContain('Each directory has its own `MEMORY.md` index.')
  expect(text).toContain('check both directories for an existing memory')
  expect(text).toContain('add a pointer to that file in the `MEMORY.md` of the directory where you saved it.')
  // The scope block sits before the types, as in core's team prompt.
  expect(text.indexOf('## Memory scope') < text.indexOf('## Types of memory')).toBe(true)
  // Core's type descriptions and frontmatter stay as core sent them.
  expect(text).toContain('<name>reference</name>')
  expect(text).toContain('  type: {{user, feedback, project, reference}}')
})

test('the short lean section gets the two folders and the scope block at its end', () => {
  const text = rewriteSection(LEAN, GLOBAL)?.text ?? ''
  expect(text).toContain(`You have a persistent file-based memory with two directories: a project directory at \`${PROJECT}\``)
  expect(text).toContain('Each memory is one file holding one fact')
  expect(text).toContain('add a one-line pointer in the `MEMORY.md` of the directory where you saved it')
  expect(text.trimEnd().endsWith('never save API keys or user credentials.')).toBe(true)
})

test('a read-only section stays read-only and the global folder comes in read-only', () => {
  const r = rewriteSection(coreSection(PROJECT, true), GLOBAL)
  expect(r?.mode).toBe('read-only')
  const text = r?.text ?? ''
  expect(text).toContain(`machine-wide global directory at \`${GLOBAL}/\`. This memory is read-only this session — you cannot save new memories to either directory.`)
  expect(text).toContain('There are two scope levels, both read-only this session:')
  expect(text).not.toContain('already exist')
  expect(text).not.toContain('Choose the directory by type')
  expect(text).not.toContain('## How to save memories')
})

test('the same input gives the same text, so the prompt cache holds', () => {
  const a = rewriteSection(coreSection(PROJECT), GLOBAL)
  const b = rewriteSection(coreSection(PROJECT), `${GLOBAL}/`)
  expect(a?.text).toBe(b?.text)
  expect(rewriteSection(coreSection(PROJECT), GLOBAL)?.text).toBe(a?.text)
})

test('the global index loads like core loads MEMORY.md, and goes after the project index', () => {
  expect(indexContent('---\nx: 1\n---\n- [A](a.md) — hook\n<!-- note -->\n')).toBe('- [A](a.md) — hook')
  const long = Array.from({ length: 250 }, (_, i) => `- [M${i}](m${i}.md) — hook`).join('\n')
  const cut = indexContent(long)
  expect(cut.split('\n').length).toBe(201)
  expect(cut).toContain('> WARNING: MEMORY.md is 250 lines')
  const files = [
    { path: '/home/u/CLAUDE.md', kind: 'user', content: 'u' },
    { path: PROJECT_INDEX, kind: 'memory', content: 'p' },
    { path: '/home/u/work/CLAUDE.md', kind: 'project', content: 'w' },
  ] as const
  const entry = { path: GLOBAL_INDEX, kind: 'memory', content: 'g' } as const
  expect(withGlobalIndex(files, entry).map((f) => f.path)).toEqual(['/home/u/CLAUDE.md', PROJECT_INDEX, GLOBAL_INDEX, '/home/u/work/CLAUDE.md'])
  const once = withGlobalIndex(files, entry)
  expect(withGlobalIndex(once, entry)).toBe(once)
})

type Scene = { written: Map<string, string>; globalExists: boolean; indexExists?: boolean }

function prepare(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene) {
  mock.clock(on, { now: Date.parse('2026-10-07T13:00:00Z') })
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('fs.stat', ($, e) => {
    if (e.path === GLOBAL && s.globalExists) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    return { deny: 'no such file' }
  })
  on('fs.read', ($, e) => {
    if (e.path === GLOBAL_INDEX && s.globalExists && s.indexExists !== false) return { value: '- [Machine fact](machine-fact.md) — invented\n' }
    const text = s.written.get(e.path)
    return text === undefined ? { deny: 'no file' } : { value: text }
  })
  on('fs.write', ($, e) => {
    s.written.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/home/u/work' }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/home/u/work' } as const
const DIARY = '/home/u/.local/state/mods/global-memory/2026-10-07-abcdef12.jsonl'
const FILES = [
  { path: '/home/u/CLAUDE.md', kind: 'user', content: 'u' },
  { path: PROJECT_INDEX, kind: 'memory', content: 'p' },
] as const

function lines(s: Scene): unknown[] {
  return (s.written.get(DIARY) ?? '').trim().split('\n').filter((l) => l !== '').map((l): unknown => JSON.parse(l))
}

test('rewrites the memory section and leaves other sections alone', async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.section', ($, e) => ({ text: e.name === 'memory' ? coreSection(PROJECT) : 'core text' }))
  await $.session.start(start)
  const memory = await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })
  expect(memory.text).toContain(`machine-wide global directory at \`${GLOBAL}/\``)
  expect(memory.text).toContain(`a project directory at \`${PROJECT}\``)
  const other = await $.prompt.section({ name: 'env_info_simple', text: 'core text' })
  expect(other.text).toBe('core text')
})

test('a null memory section stays null and the context gets no global index', async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.section', () => ({ text: null }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  expect((await $.prompt.section({ name: 'memory', text: null })).text).toBeNull()
  const r = await $.prompt.context({ blocks: [], instructionFiles: FILES })
  expect(r.instructionFiles).toEqual(FILES)
})

test('a read-only memory section stays read-only in the session', async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.section', () => ({ text: coreSection(PROJECT, true) }))
  await $.session.start(start)
  const r = await $.prompt.section({ name: 'memory', text: coreSection(PROJECT, true) })
  expect(r.text).toContain('you cannot save new memories to either directory')
  expect(r.text).not.toContain('## How to save memories')
})

test('without the global folder, the section and the context stay as core sent them', async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: false }
  prepare(on, s)
  on('prompt.section', () => ({ text: coreSection(PROJECT) }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  expect((await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })).text).toBe(coreSection(PROJECT))
  expect((await $.prompt.context({ blocks: [], instructionFiles: FILES })).instructionFiles).toEqual(FILES)
})

test('disabled, the section and the context stay as core sent them, with the global folder in place', { options: { enabled: false } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.section', () => ({ text: coreSection(PROJECT) }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  expect((await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })).text).toBe(coreSection(PROJECT))
  expect((await $.prompt.context({ blocks: [], instructionFiles: FILES })).instructionFiles).toEqual(FILES)
})

test('the context gets the global MEMORY.md as a memory instruction file after the project index', async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'core' }], instructionFiles: FILES })
  expect(r.instructionFiles).toEqual([...FILES, { path: GLOBAL_INDEX, kind: 'memory', content: '- [Machine fact](machine-fact.md) — invented' }])
})

test('without the global MEMORY.md, the context stays as core sent it', async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true, indexExists: false }
  prepare(on, s)
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  expect((await $.prompt.context({ blocks: [], instructionFiles: FILES })).instructionFiles).toEqual(FILES)
})

test('a custom globalDir from the options is used', { options: { globalDir: '~/elsewhere' } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.section', () => ({ text: coreSection(PROJECT) }))
  await $.session.start(start)
  // The stub only knows the default folder, so the custom one reads as missing.
  expect((await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })).text).toBe(coreSection(PROJECT))
})

test('the session ends with one summary line counting what the mod did', async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.section', () => ({ text: coreSection(PROJECT) }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })
  await $.prompt.context({ blocks: [], instructionFiles: FILES })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const all = lines(s)
  expect(all[0]).toEqual({ at: '2026-10-07T13:00:00.000Z', session: 'abcdef12', event: 'section-rewritten' })
  expect(all[1]).toEqual({ at: '2026-10-07T13:00:00.000Z', session: 'abcdef12', event: 'context-injected' })
  expect(all[2]).toEqual({
    at: '2026-10-07T13:00:00.000Z',
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/home/u/work',
    toolCalls: 0,
    actions: { 'section-rewritten': 1, 'context-injected': 1 },
    hookMs: 0,
    maxHookMs: 0,
  })
})

test('the context gets the global index even before the memory section and with no project MEMORY.md', async ($, on) => {
  // No prompt.section yet, and only a user CLAUDE.md among the files: a new project in an interactive session.
  const files = [{ path: '/home/u/.claude/CLAUDE.md', kind: 'user' as const, content: 'rules' }]
  const s = { written: new Map<string, string>(), globalExists: true }
  prepare(on, s)
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: files }))
  await $.session.start(start)
  const r = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'core' }], instructionFiles: files })
  expect(r.instructionFiles).toEqual([...files, { path: GLOBAL_INDEX, kind: 'memory', content: '- [Machine fact](machine-fact.md) — invented' }])
})

// An ai-memory wiki with two projects: _global and work, whose memory folder the project folder links to.
const WIKI = '/home/u/wiki'
const WIKI_GLOBAL_INDEX = `${WIKI}/ws/g/_rules/indice-memorias.md`
const WIKI_WORK_INDEX = `${WIKI}/ws/w/_rules/indice-memorias.md`
const PAGE = (line: string) => `---\ntitle: Índice\nkind: rule\n---\n${line}\n`

function prepareWiki(on: Parameters<Parameters<typeof test>[1]>[1], s: Scene & { workLinked: boolean; workIndex: boolean }) {
  mock.clock(on, { now: Date.parse('2026-10-07T13:00:00Z') })
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('fs.write', ($, e) => {
    s.written.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/home/u/work' }))
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  on('fs.list', ($, e) => {
    if (e.path === WIKI) return { value: [dir('ws')] }
    if (e.path === `${WIKI}/ws`) return { value: [dir('g'), dir('w')] }
    return { deny: 'no such folder' }
  })
  on('fs.stat', ($, e) => {
    if (e.path === GLOBAL) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath: '/home/u/repo/memorias/vps' } }
    if (e.path === PROJECT.replace(/\/$/, '') && s.workLinked)
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath: '/home/u/repo/memorias/work' } }
    if (e.path === PROJECT.replace(/\/$/, '')) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: PROJECT.replace(/\/$/, '') } }
    return { deny: 'no such file' }
  })
  on('fs.read', ($, e) => {
    if (e.path === `${WIKI}/ws/g/_meta.md`) return { value: '---\nproject: _global\ntype: Scope Manifest\n---\n' }
    if (e.path === `${WIKI}/ws/w/_meta.md`) return { value: '---\nproject: work\n---\n' }
    if (e.path === WIKI_GLOBAL_INDEX) return { value: PAGE('- [Wiki fact](memorias/vps/wiki-fact.md) — from the wiki') }
    if (e.path === WIKI_WORK_INDEX && s.workIndex) return { value: PAGE('- [Work fact](work-fact.md) — from the wiki') }
    if (e.path === GLOBAL_INDEX) return { value: '- [Machine fact](machine-fact.md) — invented\n' }
    return { deny: 'no file' }
  })
}

test('with wikiDir, the global and the project index come from the wiki', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true, workLinked: true, workIndex: true }
  prepareWiki(on, s)
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  const r = await $.prompt.context({ blocks: [], instructionFiles: FILES })
  expect(r.instructionFiles).toEqual([
    FILES[0],
    { path: WIKI_WORK_INDEX, kind: 'memory', content: '- [Work fact](work-fact.md) — from the wiki' },
    { path: WIKI_GLOBAL_INDEX, kind: 'memory', content: '- [Wiki fact](memorias/vps/wiki-fact.md) — from the wiki' },
  ])
})

test('with wikiDir, a project folder that is not a link keeps core MEMORY.md', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true, workLinked: false, workIndex: true }
  prepareWiki(on, s)
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  const r = await $.prompt.context({ blocks: [], instructionFiles: FILES })
  expect(r.instructionFiles?.[1]).toEqual(FILES[1])
  expect(r.instructionFiles?.[2]?.path).toBe(WIKI_GLOBAL_INDEX)
})

test('with wikiDir, a scope without a wiki index keeps core MEMORY.md', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true, workLinked: true, workIndex: false }
  prepareWiki(on, s)
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  const r = await $.prompt.context({ blocks: [], instructionFiles: FILES })
  expect(r.instructionFiles?.[1]).toEqual(FILES[1])
})

test('with wikiDir and no wiki on disk, the global MEMORY.md is used', { options: { wikiDir: '~/nowiki' } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true, workLinked: true, workIndex: true }
  prepareWiki(on, s)
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: FILES }))
  await $.session.start(start)
  const r = await $.prompt.context({ blocks: [], instructionFiles: FILES })
  expect(r.instructionFiles).toEqual([...FILES, { path: GLOBAL_INDEX, kind: 'memory', content: '- [Machine fact](machine-fact.md) — invented' }])
})

test('metaProject and scopeOf read the names', () => {
  expect(metaProject('---\nproject: _global\ntype: Scope Manifest\n---\n')).toBe('_global')
  expect(metaProject('---\ntype: x\n---\n')).toBeNull()
  expect(scopeOf('/home/u/repo/memorias/getdemo')).toBe('getdemo')
  expect(scopeOf('/home/u/.claude/projects/-home-u-work/memory')).toBeNull()
})

const G = { project: '_global', prefix: 'memorias/vps' }
const W = { project: 'work', prefix: 'memorias/work' }

test('the wiki section saves through the MCP tools and keeps core guidance', () => {
  const r = wikiSection(coreSection(PROJECT), GLOBAL, G, W)
  const text = r?.text ?? ''
  expect(r?.mode).toBe('writable')
  expect(text).toContain('in an ai-memory wiki, reached through the `ai-memory` MCP tools')
  expect(text).toContain('never with Write or Edit')
  expect(text).toContain('`scope: "global"` at `memorias/vps/<name>.md`')
  expect(text).toContain('Write to the project `work` (with `workspace: "default"`) at `memorias/work/<name>.md`')
  expect(text).toContain('## Types of memory')
  expect(text).toContain('## What NOT to save in memory')
  expect(text).toContain('## When to access memories')
  expect(text).not.toContain('**Step 1**')
  expect(text).not.toContain('This directory already exists')
})

test('the wiki section without a project scope saves only global memories', () => {
  const text = wikiSection(coreSection(PROJECT), GLOBAL, G, null)?.text ?? ''
  expect(text).toContain('this folder has no project scope in the wiki. Save only global memories from here.')
})

test('the wiki section keeps a read-only session read-only, and the lean section gets only the rules', () => {
  expect(wikiSection(coreSection(PROJECT, true), GLOBAL, G, W)?.text).toBe(rewriteSection(coreSection(PROJECT, true), GLOBAL)?.text)
  const lean = wikiSection(LEAN, GLOBAL, G, W)?.text ?? ''
  expect(lean).toContain('## How to save memories')
  expect(lean).not.toContain('After writing the file')
  expect(scopePath('/home/u/repo/memorias/getdemo/')).toBe('memorias/getdemo')
})

test('with wikiDir, the memory section points the saves at the wiki', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true, workLinked: true, workIndex: true }
  prepareWiki(on, s)
  on('prompt.section', () => ({ text: coreSection(PROJECT) }))
  await $.session.start(start)
  const r = await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })
  expect(r.text).toContain('Write to the project `work` (with `workspace: "default"`) at `memorias/work/<name>.md`')
  expect(r.text).toContain('`scope: "global"` at `memorias/vps/<name>.md`')
})

test('with wikiDir and no wiki on disk, the memory section keeps the two-folder rewrite', { options: { wikiDir: '~/nowiki' } }, async ($, on) => {
  const s = { written: new Map<string, string>(), globalExists: true, workLinked: true, workIndex: true }
  prepareWiki(on, s)
  on('prompt.section', () => ({ text: coreSection(PROJECT) }))
  await $.session.start(start)
  const r = await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })
  expect(r.text).toBe(rewriteSection(coreSection(PROJECT), GLOBAL)?.text)
})
