import { expect, mock, test } from 'claude-code/testing'
import { pareceErro, peloComando, pelaFerramenta } from '../hooks/regras.ts'

test('cada arquivo pede a skill certa', () => {
  expect(pelaFerramenta('Read', '/w/src/a.ts')?.skill).toBe('typescript-best-practices')
  expect(pelaFerramenta('Edit', '/w/app/page.tsx')?.skill).toBe('typescript-best-practices')
  expect(pelaFerramenta('Edit', '/w/.claude/skills/x/SKILL.md')?.skill).toBe('writing-for-agents')
  expect(pelaFerramenta('Write', '/w/CLAUDE.md')?.skill).toBe('writing-for-agents')
  expect(pelaFerramenta('Edit', '/w/CONTEXT.md')?.skill).toBe('domain-modeling')
  expect(pelaFerramenta('Write', '/w/docs/adr/0003-moeda.md')?.skill).toBe('domain-modeling')
  expect(pelaFerramenta('Edit', '/w/README.md')?.skill).toBe('technical-writing')
  expect(pelaFerramenta('Read', '/w/notas.md')).toBeNull()
  expect(pelaFerramenta('Bash', '/w/a.ts')).toBeNull()
})

test('commit e PR pedem technical-writing, e citação não pede', () => {
  expect(peloComando('git add -A && git commit -m "x"')?.skill).toBe('technical-writing')
  expect(peloComando('gh pr create --title t --body b')?.skill).toBe('technical-writing')
  expect(peloComando('git log --oneline')).toBeNull()
  expect(peloComando('echo "rode git commit depois"')).toBeNull()
})

test('reconhece erro colado e "quebrou"', () => {
  expect(pareceErro('TypeError: x is not a function\n    at f (a.js:1:2)')).toBe(true)
  expect(pareceErro('o deploy quebrou de novo')).toBe(true)
  expect(pareceErro('faz o relatório de outubro')).toBe(false)
})

type Cenario = { lidas: string[]; chamadas: string[]; ausentes?: string[] }

function prepara(on: Parameters<Parameters<typeof test>[1]>[1], c: Cenario) {
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/casa' })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', ($, e) => {
    const m = /\/casa\/\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(e.path)
    if (m?.[1] === undefined || c.ausentes?.includes(m[1])) return { deny: 'sem arquivo' }
    c.lidas.push(m[1])
    return { value: `---\nname: ${m[1]}\ndescription: x\n---\n\n# Corpo de ${m[1]}\n` }
  })
  on('fs.write', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('tool.call', ($, e) => {
    c.chamadas.push(e.tool)
    return { result: 'ok', text: 'ok' }
  })
}

const inicio = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('ler um .ts entrega a skill junto com a leitura, uma vez só', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  const r = await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  expect(r).toMatchObject({ text: 'ok', context: [expect.stringContaining('# Corpo de typescript-best-practices')] })
  expect(r).toMatchObject({ context: [expect.stringContaining('Base directory for this skill: /casa/.claude/skills/typescript-best-practices')] })
  expect(await $.tool.call({ tool: 'Read', file_path: '/w/b.ts' })).not.toMatchObject({ context: [expect.anything()] })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })).toMatchObject({ text: 'ok' })
  expect(c.lidas).toEqual(['typescript-best-practices'])
  expect(c.chamadas).toEqual(['Read', 'Read', 'Edit'])
})

test('escrever sem ter lido recusa uma vez, com a skill na recusa', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  const r = await $.tool.call({ tool: 'Write', file_path: '/w/novo.ts', content: 'x' })
  expect(r).toMatchObject({ deny: expect.stringContaining('# Corpo de typescript-best-practices') })
  expect(await $.tool.call({ tool: 'Write', file_path: '/w/novo.ts', content: 'x' })).toMatchObject({ text: 'ok' })
  expect(c.chamadas).toEqual(['Write'])
})

test('commit sem technical-writing recusa uma vez, com a skill na recusa', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })).toMatchObject({ deny: expect.stringContaining('# Corpo de technical-writing') })
  expect(await $.tool.call({ tool: 'Bash', command: 'git commit -m "y"' })).toMatchObject({ text: 'ok' })
})

test('skill que o agente carregou sozinho não vem de novo', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Skill', skill: 'typescript-best-practices' })).toMatchObject({ text: 'ok' })
  await $.tool.call({ tool: 'Write', file_path: '/w/novo.ts', content: 'x' })
  expect(c.lidas).toEqual([])
  expect(c.chamadas).toEqual(['Skill', 'Write'])
})

test('skill que não existe na máquina não trava a escrita', async ($, on) => {
  const c = { lidas: [], chamadas: [], ausentes: ['writing-for-agents'] }
  prepara(on, c)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Edit', file_path: '/w/CLAUDE.md', old_string: 'a', new_string: 'b' })).toMatchObject({ text: 'ok' })
  expect(await $.tool.call({ tool: 'Edit', file_path: '/w/CLAUDE.md', old_string: 'a', new_string: 'b' })).toMatchObject({ text: 'ok' })
})

test('subagente não dispara skill', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts', agentId: 'sub1' })
  expect(c.lidas).toEqual([])
})

test('/clear esquece as skills entregues', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  await $.session.end({ reason: 'clear' })
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  expect(c.lidas).toEqual(['typescript-best-practices', 'typescript-best-practices'])
})

test('erro colado pelo João ganha o lembrete da diagnosing-bugs', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  const r = await $.prompt.submit({ text: 'TypeError: x is not a function', wait: false, origin: { kind: 'bridge' } })
  expect(r).toMatchObject({ context: [expect.stringContaining('diagnosing-bugs')] })
  const auto = await $.prompt.submit({ text: 'TypeError: x', wait: false, origin: { kind: 'scheduled-trigger' } })
  expect(auto).toMatchObject({ text: 'TypeError: x' })
  expect('context' in auto && auto.context !== undefined).toBe(false)
})

test('o agente pedindo de novo uma skill que o mod entregou recebe resposta curta', async ($, on) => {
  const c = { lidas: [], chamadas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' })
  expect(await $.tool.call({ tool: 'Skill', skill: 'typescript-best-practices' })).toMatchObject({ deny: expect.stringContaining('já veio completa') })
})
