// Segura os comandos pesados (typecheck, build, teste, Playwright) abaixo do alto de memória do grupo.
//
// Antes de rodar, o mod confere se o comando cabe no grupo mais apertado, menos a margem. Se não cabe,
// tenta com um processo só. Se ainda não cabe, espera a memória baixar. Se não baixar, recusa e diz o
// que está ocupando. Depois de rodar, guarda o pico do comando para a próxima conta, e repete com um
// processo só o comando que morreu por falta de memória (exit 137).

import type { Hook, On, PluginOptions } from 'claude-code'
import {
  chaveDoPico,
  comMedida,
  custo,
  folga,
  grupos,
  mb,
  meminfo,
  morreuPorMemoria,
  type Nivel,
  numeroOuMax,
  type Opcoes,
  opcoes,
  PADRAO,
  type Pesado,
  pesado,
  quadro,
  reduzido,
} from './regras.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Opcoes = PADRAO
let diario = ''
const CHAVE = 'picos'
// Abaixo disso a variação é ruído de outros processos do grupo.
const PICO_MINIMO = 50 * 1024 * 1024
const PASSO_DE_ESPERA_S = 5

async function anota($: Api, registro: Record<string, unknown>) {
  if (diario === '') return
  let antes = ''
  try {
    antes = await $.fs.read(diario)
  } catch {
    // primeiro registro da sessão
  }
  const linha = JSON.stringify({ em: new Date(await $.clock.now()).toISOString(), ...registro })
  await $.fs.write(diario, antes + linha + '\n')
}

async function leNiveis($: Api): Promise<Nivel[]> {
  let proc = ''
  try {
    proc = await $.fs.read('/proc/self/cgroup')
  } catch {
    return []
  }
  const niveis: Nivel[] = []
  for (const grupo of grupos(proc)) {
    try {
      const pasta = '/sys/fs/cgroup' + grupo
      const usado = numeroOuMax(await $.fs.read(pasta + '/memory.current'))
      if (usado === null) continue
      niveis.push({
        grupo,
        usado,
        alto: numeroOuMax(await $.fs.read(pasta + '/memory.high')),
        teto: numeroOuMax(await $.fs.read(pasta + '/memory.max')),
      })
    } catch {
      // grupo sem controle de memória
    }
  }
  return niveis
}

async function leMaquina($: Api) {
  try {
    return meminfo(await $.fs.read('/proc/meminfo'))
  } catch {
    return null
  }
}

async function folgaAgora($: Api): Promise<number | null> {
  return folga(await leNiveis($), await leMaquina($), o.margem)
}

async function lePicos($: Api): Promise<Record<string, number[]>> {
  const v: unknown = await $.store.get(CHAVE)
  if (typeof v !== 'object' || v === null) return {}
  const picos: Record<string, number[]> = {}
  for (const [k, n] of Object.entries(v)) {
    if (Array.isArray(n)) picos[k] = n.filter((x): x is number => typeof x === 'number')
  }
  return picos
}

async function guardaPico($: Api, chave: string, pico: number) {
  if (pico < PICO_MINIMO) return
  const picos = await lePicos($)
  await $.store.set(CHAVE, { ...picos, [chave]: comMedida(picos[chave], pico) })
  await anota($, { evento: 'pico-medido', chave, pico: mb(pico) })
}

// O uso do próprio grupo agora: o primeiro nível é o grupo da sessão. Sem grupo, o uso da máquina.
async function usoDoGrupo($: Api): Promise<number | null> {
  const proprio = (await leNiveis($))[0]
  if (proprio !== undefined) return proprio.usado
  const m = await leMaquina($)
  return m === null ? null : m.total - m.disponivel
}

async function atualizaStatus($: Api) {
  const f = await folgaAgora($)
  // Só aparece quando aperta, para a linha com o ⚠ não virar paisagem.
  if (f === null || f > 500 * 1024 * 1024) $.ui.status(undefined)
  else $.ui.status(`cabe ${mb(Math.max(0, f))} antes do alto de memória`)
}

// Decide como o comando roda: inteiro, com um processo só, ou nada, depois de esperar.
async function cabe($: Api, comando: string, p: Pesado): Promise<{ comando: string; reduzida: boolean } | null> {
  const picos = await lePicos($)
  const menor = reduzido(comando, p)
  const prazo = (await $.clock.now()) + o.esperaSegundos * 1000
  let esperou = false
  for (;;) {
    const f = await folgaAgora($)
    if (f === null || f >= custo(p, false, picos)) {
      if (esperou) await anota($, { evento: 'esperou-e-coube', chave: p.chave })
      return { comando, reduzida: false }
    }
    if (menor !== null && f >= custo(p, true, picos)) {
      await anota($, { evento: 'reduzido', chave: p.chave, folga: mb(f), esperou })
      return { comando: menor, reduzida: true }
    }
    if ((await $.clock.now()) >= prazo) {
      await anota($, { evento: 'recusado', chave: p.chave, folga: mb(f), custo: mb(custo(p, menor !== null, picos)) })
      return null
    }
    esperou = true
    // A espera fica dentro de um processo, porque o tempo dentro de uma chamada da API não conta no
    // limite de 10 s do hook, e o `$.clock.sleep` conta.
    await $.process.run(['sleep', String(PASSO_DE_ESPERA_S)])
  }
}

export function register(on: On, valores: PluginOptions) {
  o = opcoes(valores)

  on('session.start', async ($, e, next) => {
    const casa = await $.env.get('HOME')
    if (casa !== undefined) {
      const pasta = `${casa}/.local/state/mods/memoria`
      await $.process.run(['mkdir', '-p', pasta])
      const dia = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diario = `${pasta}/${dia}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    $.clock.every(60_000, async () => {
      await atualizaStatus($)
    })
    try {
      await $.command.register({ name: 'memoria', description: 'Mostra a memória de cada grupo e quanto ainda cabe', immediate: true })
    } catch (err) {
      await anota($, { evento: 'comando-recusado', erro: String(err) })
    }
    return next(e)
  })

  on('command.run', { command: 'memoria' }, async ($) => {
    const picos = Object.entries(await lePicos($)).map(([k, v]) => `picos medidos de ${k}: ${v.map(mb).join(', ')}`)
    return { text: [quadro(await leNiveis($), await leMaquina($), o.margem), ...picos].join('\n') }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const p = pesado(e.command)
    if (p === null) return next(e)
    const plano = await cabe($, e.command, p)
    if (plano === null) {
      return {
        deny:
          `O mod memoria segurou este comando (${p.chave}) por ${o.esperaSegundos} s e a memória do grupo não baixou o bastante. ` +
          `Outra sessão ou processo está ocupando a memória:\n${quadro(await leNiveis($), await leMaquina($), o.margem)}\n` +
          'Não tente de novo agora. Avise o João, ou siga com o que não precisa deste comando.',
      }
    }
    const aviso: string[] = []
    if (plano.reduzida) aviso.push(`O mod memoria rodou o comando com um processo só, porque o inteiro não cabia na memória do grupo: ${plano.comando}`)

    // Mede o pico enquanto o comando roda. Comando em segundo plano volta na hora e não dá medida.
    const base = await usoDoGrupo($)
    let maior = base ?? 0
    const relogio = e.run_in_background === true ? null : $.clock.every(1000, async () => {
      const agora = await usoDoGrupo($)
      if (agora !== null && agora > maior) maior = agora
    })
    let r = await next({ ...e, command: plano.comando })
    relogio?.cancel()
    if (base !== null && relogio !== null) await guardaPico($, chaveDoPico(p, plano.reduzida), maior - base)

    const menor = reduzido(e.command, p)
    if (!plano.reduzida && menor !== null && morreuPorMemoria(r.text ?? '')) {
      await anota($, { evento: 'repetiu-depois-do-137', chave: p.chave })
      r = await next({ ...e, command: menor })
      aviso.push(`A primeira tentativa morreu por falta de memória, e o mod memoria repetiu com um processo só: ${menor}`)
    }
    await atualizaStatus($)
    if (aviso.length === 0 || 'deny' in r) return r
    return { ...r, context: [...(r.context ?? []), ...aviso] }
  })
}
