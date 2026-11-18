import { expect, mock, test } from 'claude-code/testing'
import { estimateTokens, isMemoryPage, keywords, pageSummary, projectsAt, rankPages, recallContext, skipReason, tomlProject } from '../hooks/recall.ts'

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

const hit = (path: string, rank: number, project = '_global') => ({ project, path, rank })

test('the page with the clear text score wins, and a page far below the best stays out', () => {
  const ranked = rankPages({
    words: ['catálogo', 'conectores'],
    text: [hit('memorias/vps/nada-de-licenca.md', -18.9), hit('memorias/vps/brasil-imposto.md', -6.8), hit('memorias/vps/gateway.md', -6.4)],
    fused: [hit('memorias/vps/brasil-imposto.md', -0.04), hit('memorias/vps/nada-de-licenca.md', -0.039)],
    titles: new Map(),
    max: 3,
  })
  expect(ranked.map((h) => h.path)).toEqual(['memorias/vps/nada-de-licenca.md'])
})

test('a subject word in the page file name or title lifts the page', () => {
  const text = [hit('memorias/vps/medir.md', -13.3), hit('memorias/vps/docker.md', -13.2), hit('memorias/vps/limite.md', -11)]
  const plain = rankPages({ words: ['disco', 'vps', 'deleta'], text, fused: [], titles: new Map(), max: 1 })
  expect(plain.map((h) => h.path)).toEqual(['memorias/vps/medir.md'])
  const titles = new Map([['limite.md', 'Disco da VPS']])
  const lifted = rankPages({ words: ['disco', 'vps', 'deleta'], text, fused: [], titles, max: 1 })
  expect(lifted.map((h) => h.path)).toEqual(['memorias/vps/limite.md'])
})

test('pages go in whole while the ones below still fit their summary', () => {
  const page = (path: string, chars: number) => ({ project: '_global', path, body: `${'x'.repeat(chars - 1)}\n` })
  const r = recallContext([page('a.md', 2000), page('b.md', 2000), page('c.md', 1000)], 4000)
  expect(r?.paths).toEqual(['a.md', 'b.md', 'c.md'])
  expect(r?.summarized).toEqual([])
  expect(r?.text).toContain('<memory project="_global" path="a.md">')
  expect(recallContext([], 4000)).toBeNull()
})

test('a page too big for the budget goes in as its summary, so the next pages still fit', () => {
  // The recibos case of 2026-11-18: a 6,000-token page first, then two pages of 2,300 and 3,000.
  const sdoc = { project: 'work', path: 'sdoc.md', body: `Passo a passo dos S/ DOC.\n\nAs regras do João.\n\n## 1. Preparar\n${'p'.repeat(11000)}` }
  const contrato = { project: 'work', path: 'contrato.md', body: 'c'.repeat(4600) }
  const fechamento = { project: 'work', path: 'fechamento.md', body: `Passo a passo do fechamento.\n\n## 1. Atualizar\n${'f'.repeat(5500)}` }
  const r = recallContext([sdoc, contrato, fechamento], 4000)
  expect(r?.paths).toEqual(['sdoc.md', 'contrato.md', 'fechamento.md'])
  expect(r?.summarized).toEqual(['sdoc.md', 'fechamento.md'])
  expect(r?.text).toMatch(/<memory project="work" path="sdoc\.md">\nPasso a passo dos S\/ DOC\.\n\nAs regras do João\.\n\[Summary only: the whole page has about 5,\d{3} tokens\. Read it with memory_read_page\.\]\n<\/memory>/)
  expect(r?.text).not.toContain('## 1. Preparar')
  expect(r?.text).toContain(`<memory project="work" path="contrato.md">\n${'c'.repeat(4600)}\n</memory>`)
  expect((r?.tokens ?? 0) <= 4000).toBe(true)
})

test('a summary stops at the first subheading, or at a paragraph when the page has none', () => {
  expect(pageSummary('Lead.\n\nMore lead.\n\n### Detail\nbody')).toBe('Lead.\n\nMore lead.')
  const flat = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'w'.repeat(80)}`).join('\n\n')
  const cut = pageSummary(flat)
  expect(cut.length <= 1600).toBe(true)
  expect(flat.startsWith(cut)).toBe(true)
  expect(cut.endsWith('w')).toBe(true)
})

// A wiki with _global and getdemo on disk, the projects file that names ~/getdemo, and an ai-memory CLI
// that answers both searches.
const WIKI = '/home/u/wiki'
const DISK = 'memorias/vps/disco-da-vps.md'
const RECIBOS = 'memorias/getdemo/recibos.md'
const PROJECTS = JSON.stringify({ getdemo: { path: '~/getdemo' }, 'financeiro-getdemo': { path: '~/getdemo/financeiro' } })

type RunResult = { value: { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean } }
type Calls = { argv: string[][]; written: string[]; run?: (argv: readonly string[]) => RunResult; files?: Record<string, string> }

const ok = (answer: unknown): RunResult => ({ value: { exitCode: 0, stdout: JSON.stringify(answer), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail: RunResult = { value: { exitCode: 1, stdout: '', stderr: 'connection refused', isStdoutTruncated: false, isStderrTruncated: false } }

// The server's answers, the same through the CLI (`memory_query`) and the gateway (`memoria_memory_query`).
function answers(argv: readonly string[]): RunResult {
  const tool = (argv[argv.length - 2] ?? '').replace(/^memoria_/, '')
  const args = JSON.parse(argv[argv.length - 1] ?? '{}')
  if (tool === 'memory_query' && args.global)
    return ok({
      hits: [],
      global_hits: [
        { project_name: 'getdemo', path: RECIBOS, title: 'recibos', rank: -16 },
        { project_name: '_global', path: DISK, title: 'Disco da VPS', rank: -7 },
        { project_name: 'other', path: 'memorias/other/x.md', rank: -30 },
        { project_name: '_global', path: 'sessions/s.md', rank: -20 },
      ],
    })
  if (tool === 'memory_query') return ok({ hits: [{ path: RECIBOS, rank: -0.04 }], global_scope_hits: [{ path: DISK, rank: -0.03 }] })
  if (tool === 'memory_read_page' && args.path === RECIBOS) return ok({ body: 'A planilha de recibos sem doc fica no Drive.' })
  return fail
}

function prepareRecall(on: Parameters<Parameters<typeof test>[1]>[1], calls: Calls) {
  mock.clock(on, { now: Date.parse('2026-11-18T20:00:00Z') })
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
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
  on('fs.read', ($, e) => {
    const extra = calls.files?.[e.path]
    if (extra !== undefined) return { value: extra }
    if (e.path === `${WIKI}/ws/g/_meta.md`) return { value: '---\nproject: _global\n---\n' }
    if (e.path === `${WIKI}/ws/w/_meta.md`) return { value: '---\nproject: getdemo\n---\n' }
    if (e.path === `${WIKI}/ws/g/${DISK}`) return { value: '---\nkind: fact\n---\n# Disco da VPS\n\n30% é normal, 50% é fora de controle.\n' }
    if (e.path === `${WIKI}/ws/w/${RECIBOS}`) return { value: '---\nkind: decision\n---\nA planilha de recibos sem doc fica no Drive.\n' }
    return { deny: 'no file' }
  })
  on('process.run', ($, e) => {
    calls.argv.push([...e.argv])
    return (calls.run ?? answers)(e.argv)
  })
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context, origin: e.origin }))
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/home/u/getdemo' } as const
const ask = (text: string, kind = 'composer') => ({ text, wait: false, origin: { kind } }) as const
const diaryOf = (calls: Calls) => calls.written.join('').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))

test('a request gets its best page whole, from the project and _global only, once per conversation', { options: { wikiDir: '~/wiki', projectsFile: '~/projects.json' } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [], files: { '/home/u/projects.json': PROJECTS } }
  prepareRecall(on, calls)
  await $.session.start(start)
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  const context = (r.context ?? []).join('\n')
  expect(context).toContain('These pages are suggestions from the recall hook, picked by matching the words of this request. The hook can pick wrong pages and miss the ones that apply.')
  expect(context).toContain('Search for the memories this request needs yourself with `memory_query`, and do not limit yourself to the pages below.')
  expect(context).toContain(`<memory project="getdemo" path="${RECIBOS}">\nA planilha de recibos sem doc fica no Drive.\n</memory>`)
  expect(context).not.toContain('memorias/other/x.md')
  expect(context).not.toContain('sessions/s.md')
  expect(context).not.toContain('kind: decision')
  // Both searches ran on the subject words through the CLI: one over every project, one in the session's project.
  expect(calls.argv.map((a) => a.slice(0, 3))).toEqual([
    ['ai-memory', 'call', 'memory_query'],
    ['ai-memory', 'call', 'memory_query'],
  ])
  expect(calls.argv.map((a) => JSON.parse(a[3] ?? '{}'))).toEqual([
    { query: 'atualizar planilha recibos doc', global: true, limit: 30 },
    { query: 'atualizar planilha recibos doc', workspace: 'default', project: 'getdemo', limit: 15 },
  ])
  const again = await $.prompt.submit(ask('de novo a planilha de recibos sem doc'))
  expect((again.context ?? []).join('\n')).not.toContain(`path="${RECIBOS}"`)
  expect(diaryOf(calls).find((d) => d.event === 'recall-injected')).toMatchObject({ source: 'ai-memory', pages: [RECIBOS] })
})

test('a service message, a short prompt and an agent origin search nothing', async ($, on) => {
  const calls: Calls = { argv: [], written: [] }
  prepareRecall(on, calls)
  await $.session.start(start)
  for (const p of [ask('<task-notification> done'), ask('.'), ask('atualizar a planilha de recibos sem doc', 'peer')]) {
    const r = await $.prompt.submit(p)
    expect(r.context ?? []).toEqual([])
  }
  expect(calls.argv).toEqual([])
})

test('with the mod off, the prompt goes in untouched', { options: { enabled: false } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [] }
  prepareRecall(on, calls)
  await $.session.start(start)
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  expect(r.context ?? []).toEqual([])
  expect(calls.argv).toEqual([])
})

test('when the CLI and the gateway both fail, the prompt goes in untouched and the diary says so', { options: { gatewayCommand: 'gw call' } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [], run: () => fail }
  prepareRecall(on, calls)
  await $.session.start(start)
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  expect(r.context ?? []).toEqual([])
  expect(diaryOf(calls).map((d) => d.event)).toContain('recall-failed')
})

test('without a wiki on disk the pages come through memory_read_page', { options: { projectsFile: '~/projects.json' } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [], files: { '/home/u/projects.json': PROJECTS } }
  prepareRecall(on, calls)
  await $.session.start({ ...start, cwd: '/home/u/getdemo/financeiro' })
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  expect((r.context ?? []).join('\n')).toContain(`<memory project="getdemo" path="${RECIBOS}">\nA planilha de recibos sem doc fica no Drive.\n</memory>`)
  const read = calls.argv.find((a) => a[2] === 'memory_read_page')
  expect(JSON.parse(read?.[3] ?? '{}')).toEqual({ path: RECIBOS, workspace: 'default', project: 'getdemo', max_chars: 64000 })
  const scoped = calls.argv.filter((a) => a[2] === 'memory_query').map((a) => JSON.parse(a[3] ?? '{}')).filter((a) => a.global !== true)
  expect(scoped.map((a) => a.project).sort()).toEqual(['financeiro-getdemo', 'getdemo'])
})

test('when the ai-memory CLI fails, recall goes through the gateway', { options: { gatewayCommand: '~/bin/gateway-mcp chamar', projectsFile: '~/projects.json' } }, async ($, on) => {
  const calls: Calls = { argv: [], written: [], files: { '/home/u/projects.json': PROJECTS } }
  calls.run = (argv) => (argv[0] === 'ai-memory' ? fail : answers(argv))
  prepareRecall(on, calls)
  await $.session.start(start)
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  expect((r.context ?? []).join('\n')).toContain(`path="${RECIBOS}"`)
  const viaGateway = calls.argv.filter((a) => a[0] === '/home/u/bin/gateway-mcp')
  expect(viaGateway.every((a) => a[1] === 'chamar' && (a[2] ?? '').startsWith('memoria_'))).toBe(true)
  expect(viaGateway.length > 0).toBe(true)
  expect(diaryOf(calls).find((d) => d.event === 'recall-injected')?.source).toBe('gateway')
})

test('an .ai-memory.toml above the session folder names the project', async ($, on) => {
  const calls: Calls = { argv: [], written: [], files: { '/home/u/getdemo/.ai-memory.toml': 'workspace = "default"\nproject = "getdemo"\n' } }
  prepareRecall(on, calls)
  await $.session.start({ ...start, cwd: '/home/u/getdemo/financeiro' })
  const r = await $.prompt.submit(ask('atualizar a planilha de recibos sem doc'))
  expect((r.context ?? []).join('\n')).toContain(`path="${RECIBOS}"`)
})
