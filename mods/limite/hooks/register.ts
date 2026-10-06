// Segura o limite de uso da conta antes de ele acabar.
//
// Acima do alerta (90%), só um subagente roda por vez. Na reserva (98%), a sessão para de chamar
// ferramentas, o agente escreve onde parou, e o mod agenda a retomada para o horário em que a janela
// volta. Um prompt que o João digita durante a pausa ganha um turno sem subagente, gasto da reserva.
// Prompt automático (routine, outra sessão, aviso de tarefa) fica guardado e entra na retomada.

import type { Hook, On, PluginOptions } from 'claude-code'
import {
  classifica,
  ehAutomatico,
  leitura,
  maisCheia,
  type Faixa,
  type Janela,
  msAteVoltar,
  type Opcoes,
  opcoes,
  PADRAO,
  resumo,
  semVencidas,
  textoDaPausa,
  textoDaRetomada,
  textoDoTurnoNaReserva,
} from './regras.ts'

let o: Opcoes = PADRAO
let janelas: readonly Janela[] = []
let faixa: Faixa = { kind: 'livre' }
// O turno que o João abriu durante a pausa, que pode chamar ferramenta menos subagente.
let turnoNaReserva = false
// Prompts automáticos que chegaram durante a pausa.
const fila: string[] = []
let retomada: { cancel(): void } | null = null
let diario = ''
// Os subagentes que este mod deixou subir e ainda não terminaram. A lista do Claude Code demora a
// mostrar um subagente recém-pedido.
const vivos = new Set<string>()
let subindo = 0
// Quando a leitura em uso foi feita, por esta sessão ou pela outra que a guardou.
let lidoEm = 0

// O limite é da conta, então a última leitura de qualquer sessão vale para todas.
const CHAVE = 'janelas'

type Api = Parameters<Hook<'session.start'>>[0]

async function anota($: Api, registro: Record<string, unknown>) {
  if (diario === '') return
  let antes = ''
  try {
    antes = await $.fs.read(diario)
  } catch {
    // primeiro registro do dia
  }
  const linha = JSON.stringify({ em: new Date(await $.clock.now()).toISOString(), ...registro })
  await $.fs.write(diario, antes + linha + '\n')
}

function atualiza($: Api, novas: readonly Janela[]) {
  janelas = novas
  faixa = classifica(janelas, o)
  if (faixa.kind === 'livre') $.ui.status(undefined)
  else $.ui.status(resumo(janelas, faixa, o).split('\n')[0] ?? '')
}

async function guarda($: Api) {
  lidoEm = await $.clock.now()
  await $.store.set(CHAVE, { em: lidoEm, janelas })
}

// Pega a leitura de outra sessão, se for mais nova que a desta.
async function recarrega($: Api) {
  const l = leitura(await $.store.get(CHAVE), await $.clock.now())
  if (l === null || l.em <= lidoEm) return
  lidoEm = l.em
  atualiza($, l.janelas)
}

// A janela que segurava a sessão pode ter voltado sem nenhuma resposta nova para avisar.
async function venceu($: Api) {
  if (faixa.kind === 'livre') return
  const vigentes = semVencidas(janelas, await $.clock.now())
  if (vigentes.length !== janelas.length) atualiza($, vigentes)
}

// Agenda uma retomada só, para o horário em que a janela cheia volta.
async function agendaRetomada($: Api, janela: Janela, motivo: string) {
  if (retomada !== null) return
  const espera = msAteVoltar(janela, await $.clock.now())
  if (espera === null) {
    await anota($, { evento: 'sem-horario-de-volta', motivo, janela })
    return
  }
  await anota($, { evento: 'retomada-agendada', motivo, janela, esperaMin: Math.round(espera / 60_000) })
  retomada = $.clock.after(espera, async () => {
    retomada = null
    // A janela voltou. A leitura certa chega com a primeira resposta do turno retomado.
    faixa = { kind: 'livre' }
    $.ui.status(undefined)
    const texto = textoDaRetomada(janela, fila.splice(0))
    await anota($, { evento: 'retomando' })
    await $.prompt.submit({ text: texto })
  })
}

export function register(on: On, valores: PluginOptions) {
  o = opcoes(valores)

  on('session.start', async ($, e, next) => {
    const casa = await $.env.get('HOME')
    if (casa !== undefined) {
      const pasta = `${casa}/.local/state/mods/limite`
      await $.process.run(['mkdir', '-p', pasta])
      // Um arquivo por sessão, porque o `$.fs.write` regrava o arquivo inteiro e duas sessões no mesmo
      // arquivo apagariam linhas uma da outra.
      const dia = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diario = `${pasta}/${dia}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    const propria = (await $.session.usage()).rateLimits
    if (propria.length > 0) {
      atualiza($, propria)
      await guarda($)
    } else {
      await recarrega($)
    }
    $.clock.every(60_000, async () => {
      await recarrega($)
      await venceu($)
    })
    try {
      await $.command.register({ name: 'limite', description: 'Mostra o limite de uso da conta e o que o mod limite está segurando', immediate: true })
    } catch (err) {
      await anota($, { evento: 'comando-recusado', erro: String(err) })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const antes = faixa.kind
    atualiza($, e.rateLimits)
    await guarda($)
    if (faixa.kind !== antes) await anota($, { evento: 'faixa', de: antes, para: faixa.kind, janelas })
    return next(e)
  })

  on('command.run', { command: 'limite' }, async () => {
    const pendente = retomada === null ? '' : '\nretomada agendada'
    const guardadas = fila.length === 0 ? '' : `\n${fila.length} mensagem(ns) guardada(s) para a retomada`
    return { text: resumo(janelas, faixa, o) + pendente + guardadas }
  })

  on('prompt.submit', async ($, e, next) => {
    await venceu($)
    // Registra a origem de cada prompt, para confirmar nas sessões reais que o João chega como `bridge`.
    await anota($, { evento: 'prompt', origem: e.origin.kind, faixa: faixa.kind })
    if (faixa.kind !== 'pausada') return next(e)
    if (!ehAutomatico(e.origin)) {
      turnoNaReserva = true
      await anota($, { evento: 'turno-na-reserva', origem: e.origin.kind })
      return next({ ...e, context: [...(e.context ?? []), textoDoTurnoNaReserva(faixa.janela)] })
    }
    fila.push(e.text)
    await anota($, { evento: 'prompt-guardado', origem: e.origin.kind })
    await agendaRetomada($, faixa.janela, 'prompt automático na pausa')
    return { drop: 'O limite de uso está na reserva. A mensagem entra na retomada.' }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) turnoNaReserva = false
    else vivos.delete(e.agentId)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await venceu($)
    if (faixa.kind !== 'pausada' || turnoNaReserva) return next(e)
    await anota($, { evento: 'ferramenta-recusada', tool: e.tool, agentId: e.agentId })
    await agendaRetomada($, faixa.janela, 'trabalho interrompido pela pausa')
    return { deny: textoDaPausa(faixa.janela, o) }
  })

  on('agent.spawn', async ($, e, next) => {
    await venceu($)
    if (faixa.kind === 'pausada') {
      return { deny: 'O limite de uso está na reserva, e nela não roda subagente. Faça a tarefa direto, lendo só o trecho que precisar.' }
    }
    const lista = await $.agent.list()
    for (const a of lista) if (a.status !== 'running') vivos.delete(a.id)
    // Daqui até o `subindo += 1` não há await: dois pedidos na mesma resposta não passam juntos.
    const rodando = Math.max(lista.filter((a) => a.status === 'running').length, subindo + vivos.size)
    if (faixa.kind === 'contida' && rodando > 0) {
      await anota($, { evento: 'subagente-recusado', rodando })
      return {
        deny:
          `O limite de uso está em ${faixa.janela.percentUsed}%, e acima de ${o.alerta}% só um subagente roda por vez. ` +
          'Espere o que está rodando terminar, ou faça a tarefa direto.',
      }
    }
    subindo += 1
    try {
      const r = await next(e)
      const id: unknown = Reflect.get(r, 'agentId')
      if (typeof id === 'string') vivos.add(id)
      return r
    } finally {
      subindo -= 1
    }
  })

  // `/clear`, `/resume` e `/branch` trocam a conversa sem recarregar o mod. A retomada agendada e as
  // mensagens guardadas eram da conversa anterior.
  on('session.end', async ($, e, next) => {
    retomada?.cancel()
    retomada = null
    turnoNaReserva = false
    vivos.clear()
    const perdidas = fila.splice(0)
    if (perdidas.length > 0 || e.reason !== 'other') await anota($, { evento: 'conversa-trocada', motivo: e.reason, perdidas: perdidas.length })
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    if (Reflect.get(e, 'error') === 'rate_limit') {
      await anota($, { evento: 'bateu-100', retomarNoErro: o.retomarNoErro })
      if (o.retomarNoErro) {
        const cheia = maisCheia((await $.session.usage()).rateLimits)
        if (cheia !== null) await agendaRetomada($, cheia, 'erro de limite')
      }
    }
    return next(e)
  })
}
