import { expect, mock, test } from 'claude-code/testing'

const AGORA = Date.parse('2026-10-06T20:00:00Z')
const VOLTA = '2026-10-06T22:30:00.000Z'

type Stubs = { submetidos: string[]; rodando: number; usoInicial: number | null; guardado?: Record<string, unknown> }

function janelas(cinco: number) {
  return [
    { kind: 'five_hour', percentUsed: cinco, resetsAt: VOLTA },
    { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-11T16:00:00.000Z' },
  ]
}

// Registra os stubs que o session.start e o resto do mod pedem. Devolve o relógio e o que o mod submeteu.
function prepara(on: Parameters<Parameters<typeof test>[1]>[1], s: Stubs) {
  const relogio = mock.clock(on, { now: AGORA })
  mock.env(on, { HOME: '/casa' })
  mock.store(on, s.guardado ?? {})
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('session.usage', () => ({ value: { startedAt: AGORA, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: s.usoInicial === null ? [] : janelas(s.usoInicial) } }))
  on('command.register', () => ({ value: undefined }))
  on('fs.read', () => ({ deny: 'sem arquivo' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: Array.from({ length: s.rodando }, (_, i) => ({ id: `a${i}`, description: '', type: 'Explore', status: 'running' })) }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', () => ({ result: 'rodou' }))
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `novo${++n}` }))
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('prompt.submit', ($, e) => {
    s.submetidos.push(e.text)
    return { text: e.text }
  })
  return relogio
}

const inicio = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('abaixo do alerta, ferramenta e subagente passam', async ($, on) => {
  const s = { submetidos: [], rodando: 3, usoInicial: 50 }
  prepara(on, s)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'rodou' })
  expect(await $.agent.spawn({ prompt: 'leia', description: 'ler', subagentType: 'Explore' })).toMatchObject({ agentId: 'novo1' })
})

test('acima do alerta, só um subagente roda por vez', async ($, on) => {
  const s = { submetidos: [], rodando: 1, usoInicial: 91 }
  prepara(on, s)
  await $.session.start(inicio)
  const recusa = await $.agent.spawn({ prompt: 'leia', description: 'ler', subagentType: 'Explore' })
  expect(recusa).toMatchObject({ deny: expect.stringContaining('só um subagente') })
})

test('na reserva, recusa ferramenta e retoma quando a janela volta', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 97 }
  const relogio = prepara(on, s)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'rodou' })

  await $.session.measure({ rateLimits: janelas(98), context: { tokens: 0, window: 200000, percent: 0 }, changed: ['rateLimits'] })
  const recusa = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(recusa).toMatchObject({ deny: expect.stringContaining('98%') })
  expect(recusa).toMatchObject({ deny: expect.stringContaining('06/10 às 19:30') })

  // A volta é 22:30 UTC, mais 2 min de margem. Um minuto antes, nada.
  await relogio.set(Date.parse(VOLTA) + 60_000)
  expect(s.submetidos.length).toBe(0)
  await relogio.set(Date.parse(VOLTA) + 2 * 60_000)
  expect(s.submetidos.length).toBe(1)
  expect(s.submetidos[0]).toContain('O limite voltou')

  // Depois da retomada, a ferramenta passa de novo.
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'rodou' })
})

test('na reserva, o prompt do João ganha um turno sem subagente', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 98 }
  prepara(on, s)
  await $.session.start(inicio)
  const entrou = await $.prompt.submit({ text: 'confere o deploy', wait: false, origin: { kind: 'bridge' } })
  expect(entrou).toMatchObject({ text: 'confere o deploy' })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'rodou' })
  expect(await $.agent.spawn({ prompt: 'leia', description: 'ler', subagentType: 'Explore' })).toMatchObject({ deny: expect.stringContaining('reserva') })

  // Fim do turno do João: a pausa volta a valer.
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, usage: null })
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('Pausado') })
})

test('na reserva, prompt automático fica guardado e entra na retomada', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 99 }
  const relogio = prepara(on, s)
  await $.session.start(inicio)
  const guardado = await $.prompt.submit({ text: 'routine: relatório diário', wait: false, origin: { kind: 'scheduled-trigger' } })
  expect(guardado).toMatchObject({ drop: expect.stringContaining('retomada') })

  await relogio.set(Date.parse(VOLTA) + 2 * 60_000)
  expect(s.submetidos.length).toBe(1)
  expect(s.submetidos[0]).toContain('1. routine: relatório diário')
})

test('/limite mostra as janelas e o estado', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 91 }
  prepara(on, s)
  await $.session.start(inicio)
  const r = await $.command.run({ command: 'limite', args: '' })
  expect(r.text).toContain('contida acima de 90%')
  expect(r.text).toContain('janela de 5 horas: 91%, volta 06/10 às 19:30')
})

test('sessão nova sem leitura própria usa a que outra sessão guardou', async ($, on) => {
  const guardado = { janelas: { em: AGORA - 30_000, janelas: janelas(98) } }
  const s = { submetidos: [], rodando: 0, usoInicial: null, guardado }
  prepara(on, s)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('Pausado') })
})

test('leitura guardada de janela que já voltou não pausa', async ($, on) => {
  const antiga = [{ kind: 'five_hour', percentUsed: 99, resetsAt: '2026-10-06T19:00:00.000Z' }]
  const s = { submetidos: [], rodando: 0, usoInicial: null, guardado: { janelas: { em: AGORA - 3_600_000, janelas: antiga } } }
  prepara(on, s)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'rodou' })
})

test('/clear cancela a retomada da conversa anterior', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 98 }
  const relogio = prepara(on, s)
  await $.session.start(inicio)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ deny: expect.stringContaining('Pausado') })
  await $.session.end({ reason: 'clear' })
  await relogio.set(Date.parse(VOLTA) + 5 * 60_000)
  expect(s.submetidos.length).toBe(0)
})

test('janela que volta com a sessão parada solta a pausa sem esperar resposta nova', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 98 }
  const relogio = prepara(on, s)
  await $.session.start(inicio)
  await relogio.set(Date.parse(VOLTA) + 1_000)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toMatchObject({ result: 'rodou' })
  expect(await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'scheduled-trigger' } })).toMatchObject({ text: 'oi' })
})

test('acima do alerta, dois subagentes pedidos juntos: só um sobe', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 91 }
  prepara(on, s)
  await $.session.start(inicio)
  const pedido = { prompt: 'leia', description: 'ler', subagentType: 'Explore' }
  const [a, b] = await Promise.all([$.agent.spawn(pedido), $.agent.spawn(pedido)])
  const recusados = [a, b].filter((r) => 'deny' in r).length
  expect(recusados).toBe(1)
})

test('subagente que terminou libera a vaga', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 91 }
  prepara(on, s)
  await $.session.start(inicio)
  const pedido = { prompt: 'leia', description: 'ler', subagentType: 'Explore' }
  expect(await $.agent.spawn(pedido)).toMatchObject({ agentId: 'novo1' })
  expect(await $.agent.spawn(pedido)).toMatchObject({ deny: expect.stringContaining('só um subagente') })
  await $.turn.complete({ turnId: 't', agentId: 'novo1', answer: 'ok', durationMs: 5, isAborted: false, usage: null })
  expect(await $.agent.spawn(pedido)).toMatchObject({ agentId: 'novo2' })
})

test('na reserva, prompt de origem não classificada conta como do João', async ($, on) => {
  const s = { submetidos: [], rodando: 0, usoInicial: 98 }
  prepara(on, s)
  await $.session.start(inicio)
  expect(await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'unclassified' } })).toMatchObject({ text: 'oi' })
})
