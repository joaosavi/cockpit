import { expect, mock, test } from 'claude-code/testing'
import { comMedida, folga, grupos, pesado, reduzido } from '../hooks/regras.ts'

const MB = 1024 * 1024
const GB = 1024 * MB
const ALTO = 3 * GB
// Com a margem de 2%, cabe até 98% do alto.
const LIMITE = ALTO * 0.98

test('reconhece os corredores pesados e ignora o que só cita o nome', () => {
  expect(pesado('yarn turbo run typecheck')).toMatchObject({ tipo: 'typecheck' })
  expect(pesado('cd apps/web && npx vitest run src')).toMatchObject({ tipo: 'teste', chave: 'npx vitest' })
  expect(pesado('npx tsc --noEmit -p .')).toMatchObject({ tipo: 'typecheck' })
  expect(pesado('yarn workspace web build')).toMatchObject({ tipo: 'build', chave: 'yarn workspace web build' })
  expect(pesado('yarn build')).toMatchObject({ tipo: 'build' })
  expect(pesado('npx playwright test e2e')).toMatchObject({ tipo: 'playwright' })
  expect(pesado('git commit -m "roda tsc e vitest"')).toBeNull()
  expect(pesado('grep vitest package.json')).toBeNull()
  expect(pesado('tsc --version')).toBeNull()
  expect(pesado("cat > a.sh <<'EOF'\nyarn test\nEOF")).toBeNull()
})

test('reduz o paralelismo de quem aceita, e não do tsc', () => {
  const t = 'yarn turbo run test --filter api'
  const p = pesado(t)
  expect(p === null ? null : reduzido(t, p)).toBe('yarn turbo run test --concurrency=1 --filter api')
  const u = 'yarn turbo run test:unit --filter api'
  const pu = pesado(u)
  expect(pu === null ? null : reduzido(u, pu)).toBe('yarn turbo run test:unit --concurrency=1 --filter api')
  const v = 'npx vitest run'
  const pv = pesado(v)
  expect(pv === null ? null : reduzido(v, pv)).toBe('npx vitest --maxWorkers=1 run')
  const c = 'npx tsc --noEmit'
  const pc = pesado(c)
  expect(pc === null ? 'x' : reduzido(c, pc)).toBeNull()
})

test('a folga é a do grupo mais apertado, e sem grupo vale a máquina', () => {
  const niveis = [
    { grupo: '/a/b', usado: 1 * GB, alto: 3 * GB, teto: null },
    { grupo: '/a', usado: 4 * GB, alto: 4.5 * GB, teto: null },
  ]
  expect(folga(niveis, null, 0)).toBe(0.5 * GB)
  expect(folga([], { disponivel: 8 * GB, total: 16 * GB }, 2)).toBe(8 * GB - 16 * GB * 0.02)
  expect(grupos('0::/agentes.slice/getdemo-rc.service\n')).toEqual(['/agentes.slice/getdemo-rc.service', '/agentes.slice'])
})

type Cenario = { usado: number[]; comandos: string[]; respostas: string[]; picos?: Record<string, number[]> }

// O grupo da sessão tem o uso do primeiro item de `usado`; cada `sleep` do mod passa para o próximo.
function prepara(on: Parameters<Parameters<typeof test>[1]>[1], c: Cenario) {
  const relogio = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/casa' })
  mock.store(on, c.picos === undefined ? {} : { picos: c.picos })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', ($, e) => {
    const p = e.path
    if (p.endsWith('/proc/self/cgroup')) return { value: '0::/agentes.slice/getdemo-rc.service\n' }
    if (p.endsWith('getdemo-rc.service/memory.current')) return { value: String(c.usado[0]) }
    if (p.endsWith('getdemo-rc.service/memory.high')) return { value: String(ALTO) }
    if (p.endsWith('memory.max')) return { value: 'max' }
    if (p.endsWith('agentes.slice/memory.current')) return { value: String(c.usado[0]) }
    if (p.endsWith('agentes.slice/memory.high')) return { value: 'max' }
    return { deny: 'sem arquivo' }
  })
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'sleep') {
      if (c.usado.length > 1) c.usado.shift()
      await relogio.advance(5000)
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', ($, e) => {
    c.comandos.push(String(Reflect.get(e, 'command')))
    const texto = c.respostas.shift() ?? 'ok'
    return { result: texto, text: texto }
  })
  return relogio
}

const inicio = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('comando que não é pesado passa sem conta', async ($, on) => {
  const c = { usado: [LIMITE], comandos: [], respostas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(c.comandos).toEqual(['ls -la'])
})

test('comando que cabe roda como veio', async ($, on) => {
  const c = { usado: [LIMITE - 2 * GB], comandos: [], respostas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Bash', command: 'yarn turbo run typecheck' })
  expect(c.comandos).toEqual(['yarn turbo run typecheck'])
})

test('sem espaço para o inteiro, roda com um processo só e avisa o agente', async ($, on) => {
  const c = { usado: [LIMITE - 500 * MB], comandos: [], respostas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(c.comandos).toEqual(['yarn turbo run test --concurrency=1'])
  expect(r).toMatchObject({ context: [expect.stringContaining('um processo só')] })
})

test('sem espaço nem para um processo, espera a memória baixar', async ($, on) => {
  const c = { usado: [LIMITE - 100 * MB, LIMITE - 100 * MB, LIMITE - 2 * GB], comandos: [], respostas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.comandos).toEqual(['npx tsc --noEmit'])
})

test('se a memória não baixa no prazo, recusa e mostra os grupos', async ($, on) => {
  const c = { usado: [LIMITE - 100 * MB], comandos: [], respostas: [] }
  prepara(on, c)
  await $.session.start(inicio)
  const r = await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.comandos).toEqual([])
  expect(r).toMatchObject({ deny: expect.stringContaining('/agentes.slice/getdemo-rc.service: usa') })
})

test('comando que morreu com 137 roda de novo com um processo só', async ($, on) => {
  const c = { usado: [LIMITE - 2 * GB], comandos: [], respostas: ['Exit code 137\nKilled', 'ok'] }
  prepara(on, c)
  await $.session.start(inicio)
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(c.comandos).toEqual(['yarn turbo run test', 'yarn turbo run test --concurrency=1'])
  expect(r).toMatchObject({ text: 'ok', context: [expect.stringContaining('morreu por falta de memória')] })
})

test('o pico medido antes vale mais que a estimativa', async ($, on) => {
  // tsc estimado em 1 GB não caberia em 500 MB, mas o pico medido foi 300 MB.
  const c = { usado: [LIMITE - 500 * MB], comandos: [], respostas: [], picos: { 'npx tsc': [200 * MB, 300 * MB] } }
  prepara(on, c)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.comandos).toEqual(['npx tsc --noEmit'])
})

test('guarda só as 3 últimas medidas, para uma medida inflada sair sozinha', () => {
  expect(comMedida([5 * GB, 300 * MB, 310 * MB], 290 * MB)).toEqual([300 * MB, 310 * MB, 290 * MB])
  expect(comMedida(undefined, 1 * GB)).toEqual([1 * GB])
})
