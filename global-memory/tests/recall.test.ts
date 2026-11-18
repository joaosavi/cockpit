import { expect, mock, test } from 'claude-code/testing'
import { estimateTokens, indexLines, indexProblems, indexWarning, isMemoryPage, keywords, rankPages, recallContext, skipReason } from '../hooks/recall.ts'
import { coreSection } from './core-section.ts'

test('keywords drop filler and function words and keep acronyms', () => {
  expect(keywords('ajuste do IR do CDB')).toEqual(['ajuste', 'ir', 'cdb'])
  expect(keywords('E cade a porra do dictate quem que ta cuidando disso? Acelera que eu quero usar o dictate')).toEqual(['dictate', 'cuidando', 'acelera'])
  expect(keywords('de onde veio o catálogo de conectores')).toEqual(['catálogo', 'conectores'])
})

test('a service message or a prompt with no subject gets no recall', () => {
  expect(skipReason('.')).toBe('short')
  expect(skipReason('responda só ok')).toBe('short')
  expect(skipReason('<task-notification> <task-id>b1</task-id>')).toBe('service')
  expect(skipReason('<cross-session-message from-name="coordenador"> Liberado: o pc-run voltou.')).toBe('service')
  expect(skipReason('<mensagem de="agent-queue" em="18/11 16:29"> saiu da fila')).toBe('service')
  expect(skipReason('Me manda os comandos pelo Telegram')).toBeNull()
})

test('only memory pages count, and index lines are read by file name', () => {
  expect(isMemoryPage('memorias/vps/disco-da-vps.md')).toBe(true)
  expect(isMemoryPage('_rules/indice-memorias.md')).toBe(false)
  expect(isMemoryPage('sessions/be8bec8b.md')).toBe(false)
  expect(isMemoryPage('log-2026-11.md')).toBe(false)
  const lines = indexLines('Pasta memorias/vps\n- [Disco da VPS](disco-da-vps.md) — 30% é normal\n- [Glossário](memorias/vps/glossario-ditado.md) — trocas do ditado\n')
  expect(lines.get('disco-da-vps.md')).toBe('Disco da VPS — 30% é normal')
  expect(lines.get('glossario-ditado.md')).toBe('Glossário — trocas do ditado')
})

const hit = (path: string, rank: number, project = '_global') => ({ project, path, rank })

test('the page with the clear text score wins, and a page far below the best stays out', () => {
  const ranked = rankPages({
    words: ['catálogo', 'conectores'],
    text: [hit('memorias/vps/nada-de-licenca.md', -18.9), hit('memorias/vps/brasil-imposto.md', -6.8), hit('memorias/vps/gateway.md', -6.4)],
    fused: [hit('memorias/vps/brasil-imposto.md', -0.04), hit('memorias/vps/nada-de-licenca.md', -0.039)],
    lines: new Map(),
    max: 3,
  })
  expect(ranked.map((h) => h.path)).toEqual(['memorias/vps/nada-de-licenca.md'])
})

test('a subject word in the page name or index line lifts the page', () => {
  const text = [hit('memorias/vps/medir.md', -13.3), hit('memorias/vps/docker.md', -13.2), hit('memorias/vps/limite.md', -11)]
  const plain = rankPages({ words: ['disco', 'vps', 'deleta'], text, fused: [], lines: new Map(), max: 1 })
  expect(plain.map((h) => h.path)).toEqual(['memorias/vps/medir.md'])
  const lines = new Map([['limite.md', 'Disco da VPS — 30% é normal']])
  const lifted = rankPages({ words: ['disco', 'vps', 'deleta'], text, fused: [], lines, max: 1 })
  expect(lifted.map((h) => h.path)).toEqual(['memorias/vps/limite.md'])
})

test('pages go in whole within the budget; the first one goes in cut when it alone is over', () => {
  const page = (path: string, chars: number) => ({ project: '_global', path, body: `${'x'.repeat(chars - 1)}\n` })
  const r = recallContext([page('a.md', 3000), page('b.md', 3000), page('c.md', 6000)], 4000)
  expect(r?.paths).toEqual(['a.md', 'b.md'])
  expect(r?.text).toContain('<memory project="_global" path="a.md">')
  expect((r?.tokens ?? 0) <= 4000).toBe(true)
  const big = recallContext([page('big.md', 30000)], 4000)
  expect(big?.paths).toEqual(['big.md'])
  expect(big?.text).toContain('[cut here: read the rest with memory_read_page]')
  expect(estimateTokens(big?.text ?? '') <= 4000).toBe(true)
  expect(recallContext([], 4000)).toBeNull()
})

test('index problems name each line over 200 characters and a body over the limit', () => {
  const long = `- [A](a.md) — ${'y'.repeat(200)}`
  expect(indexProblems(`- [B](b.md) — ok\n${long}`, 25000)).toEqual([`line 2 has ${long.length} characters, over 200`])
  expect(indexProblems('z'.repeat(30), 20)).toEqual(['30 characters, over 20'])
})

test('an index over the limits gets a warning that says what to shorten', () => {
  expect(indexWarning('- [A](a.md) — ok')).toBeNull()
  const long = `- [A](a.md) — ${'y'.repeat(200)}`
  expect(indexWarning(long)).toBe('> WARNING: this index has 1 lines over 200 characters. Shorten each hook to one line under 200 characters with memory_patch_page and move the detail into the page itself.')
  expect(indexWarning(Array.from({ length: 150 }, (_, i) => `- [M${i}](m${i}.md) — ${'h'.repeat(140)}`).join('\n'))).toContain('characters (keep it under 22000)')
})

// A wiki with _global and the project work, a search command that answers both queries, and two pages.
const WIKI = '/home/u/wiki'
const PROJECT = '/home/u/.claude/projects/-home-u-work/memory/'
const GLOBAL = '/home/u/.claude/global-memory'
const DISK = 'memorias/vps/disco-da-vps.md'
const RECIBOS = 'memorias/work/recibos.md'

type Calls = { argv: string[][]; written: string[]; fail?: boolean; globalIndex?: string }

function prepareRecall(on: Parameters<Parameters<typeof test>[1]>[1], calls: Calls) {
  mock.clock(on, { now: Date.parse('2026-11-18T20:00:00Z') })
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.start', () => ({ cwd: '/home/u/work' }))
  on('fs.write', ($, e) => {
    calls.written.push(e.text)
    return { value: undefined }
  })
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  on('fs.list', ($, e) => {
    if (e.path === WIKI) return { value: [dir('ws')] }
    if (e.path === `${WIKI}/ws`) return { value: [dir('g'), dir('w')] }
    return { deny: 'no such folder' }
  })
  on('fs.stat', ($, e) => {
    if (e.path === GLOBAL) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath: '/home/u/repo/memorias/vps' } }
    if (e.path === PROJECT.replace(/\/$/, '')) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath: '/home/u/repo/memorias/work' } }
    return { deny: 'no such file' }
  })
  on('fs.read', ($, e) => {
    if (e.path === `${WIKI}/ws/g/_meta.md`) return { value: '---\nproject: _global\n---\n' }
    if (e.path === `${WIKI}/ws/w/_meta.md`) return { value: '---\nproject: work\n---\n' }
    if (e.path === `${WIKI}/ws/g/_rules/indice-memorias.md`) return { value: calls.globalIndex ?? '- [Disco da VPS](disco-da-vps.md) — 30% é normal\n' }
    if (e.path === `${WIKI}/ws/w/_rules/indice-memorias.md`) return { value: '- [Recibos](recibos.md) — planilha de recibos\n' }
    if (e.path === `${WIKI}/ws/g/${DISK}`) return { value: '---\nkind: fact\n---\n# Disco da VPS\n\n30% é normal, 50% é fora de controle.\n' }
    if (e.path === `${WIKI}/ws/w/${RECIBOS}`) return { value: '---\nkind: decision\n---\nA planilha de recibos sem doc fica no Drive.\n' }
    return { deny: 'no file' }
  })
  on('process.run', ($, e) => {
    calls.argv.push([...e.argv])
    if (calls.fail === true) return { value: { exitCode: 1, stdout: '', stderr: 'connection refused', isStdoutTruncated: false, isStderrTruncated: false } }
    const args = JSON.parse(e.argv[3] ?? '{}')
    const answer = args.global
      ? { hits: [], global_hits: [{ project_name: 'work', path: RECIBOS, rank: -16 }, { project_name: '_global', path: DISK, rank: -7 }, { project_name: 'other', path: 'memorias/other/x.md', rank: -30 }, { project_name: '_global', path: 'sessions/s.md', rank: -20 }] }
      : { hits: [{ path: RECIBOS, rank: -0.04 }], global_scope_hits: [{ path: DISK, rank: -0.03 }] }
    return { value: { exitCode: 0, stdout: JSON.stringify(answer), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.section', () => ({ text: coreSection(PROJECT) }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context, origin: e.origin }))
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/home/u/work' } as const
const ask = (text: string, kind = 'composer') => ({ text, wait: false, origin: { kind } }) as const

test('a request gets its best page whole, from the project and _global only, once per conversation', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [] }
  prepareRecall(on, calls)
  await $.session.start(start)
  await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  const context = (r.context ?? []).join('\n')
  expect(context).toContain(`<memory project="work" path="${RECIBOS}">\nA planilha de recibos sem doc fica no Drive.\n</memory>`)
  expect(context).not.toContain('memorias/other/x.md')
  expect(context).not.toContain('sessions/s.md')
  expect(context).not.toContain('kind: decision')
  // Both searches ran on the subject words: one over every project, one in the session's project.
  expect(calls.argv.map((a) => JSON.parse(a[3] ?? '{}'))).toEqual([
    { query: 'atualizar planilha recibos doc', global: true, limit: 30 },
    { query: 'atualizar planilha recibos doc', workspace: 'default', project: 'work', limit: 15 },
  ])
  const again = await $.prompt.submit(ask('de novo a planilha de recibos sem doc'))
  expect((again.context ?? []).join('\n')).not.toContain(`path="${RECIBOS}"`)
  const diary = calls.written.join('').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  expect(diary.find((d) => d.event === 'recall-injected')?.pages).toEqual([RECIBOS])
})

test('a service message, a short prompt and an agent origin search nothing', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [] }
  prepareRecall(on, calls)
  await $.session.start(start)
  await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })
  for (const p of [ask('<task-notification> done'), ask('.'), ask('atualizar a planilha de recibos sem doc', 'peer')]) {
    const r = await $.prompt.submit(p)
    expect(r.context ?? []).toEqual([])
  }
  expect(calls.argv).toEqual([])
})

test('without wikiDir, or with recall off, the prompt goes in untouched', { options: { wikiDir: '~/wiki', recall: false } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [] }
  prepareRecall(on, calls)
  await $.session.start(start)
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  expect(r.context ?? []).toEqual([])
  expect(calls.argv).toEqual([])
})

test('a search command that fails leaves the prompt untouched and logs it', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [] }
  calls.fail = true
  prepareRecall(on, calls)
  await $.session.start(start)
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  expect(r.context ?? []).toEqual([])
  expect(calls.written.join('')).toContain('"event":"recall-failed"')
})

test('the mod flags a wiki index over the limits where the agent reads it', { options: { wikiDir: '~/wiki' } }, async ($, on) => {
  const big = Array.from({ length: 122 }, (_, i) => `- [Memória ${i}](m${i}.md) — ${'gancho comprido '.repeat(13)}`).join('\n')
  const calls: Calls = { argv: [], written: [], globalIndex: big }
  prepareRecall(on, calls)
  const files = [{ path: `${PROJECT}MEMORY.md`, kind: 'memory' as const, content: '' }]
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: files }))
  await $.session.start(start)
  await $.prompt.section({ name: 'memory', text: coreSection(PROJECT) })
  const r = await $.prompt.context({ blocks: [], instructionFiles: files })
  const global = (r.instructionFiles ?? []).find((f) => f.path === `${WIKI}/ws/g/_rules/indice-memorias.md`)
  expect(global?.content).toMatch(/\n> WARNING: this index has \d+ characters \(keep it under 22000\) and 122 lines over 200 characters\. Shorten each hook/)
  const work = (r.instructionFiles ?? []).find((f) => f.path === `${WIKI}/ws/w/_rules/indice-memorias.md`)
  expect(work?.content).toBe('- [Recibos](recibos.md) — planilha de recibos')
  expect(calls.written.join('')).toContain('"event":"index-over-limit"')
})
