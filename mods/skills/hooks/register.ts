// Carrega a skill certa na hora certa, no lugar das regras "carregue a skill X antes" do CLAUDE.md.
//
// Leitura de um arquivo que pede skill: o mod entrega a skill junto com a leitura, e ela chega antes da edição,
// porque o Edit exige ler o arquivo antes. Escrita sem leitura antes (arquivo novo, commit, PR): o mod
// recusa a chamada uma vez, com a skill no texto da recusa, para o agente refazer seguindo ela. Erro colado no
// prompt: o mod lembra o agente de carregar a diagnosing-bugs.

import type { Hook, On } from 'claude-code'
import { comoSkill, ESCRITA, LEITURA, LEMBRETE_DE_BUG, pareceErro, peloComando, pelaFerramenta, textoDaRecusa } from './regras.ts'

type Api = Parameters<Hook<'session.start'>>[0]

// As skills já carregadas nesta conversa, pelo mod ou pelo próprio agente.
const carregadas = new Set<string>()
// As que o próprio mod entregou, cujo texto já está na conversa.
const entregues = new Set<string>()
// As que não existem nesta máquina. O mod não procura de novo.
const ausentes = new Set<string>()
let diario = ''

const AUTOMATICAS = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'plugin'])

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

// Lê o SKILL.md direto do disco. A ferramenta Skill chamada por um mod responde "Launching skill"
// mas não põe o texto da skill na conversa, então o mod entrega o texto ele mesmo.
async function textoDaSkill($: Api, skill: string): Promise<string | null> {
  const pastas = [`${await $.session.cwd()}/.claude/skills`, `${(await $.env.get('HOME')) ?? ''}/.claude/skills`]
  for (const pasta of pastas) {
    const dir = `${pasta}/${skill}`
    try {
      return comoSkill(dir, await $.fs.read(`${dir}/SKILL.md`))
    } catch {
      // tenta a próxima pasta
    }
  }
  return null
}

async function carrega($: Api, skill: string, motivo: string): Promise<string | null> {
  if (carregadas.has(skill) || ausentes.has(skill)) return null
  const texto = await textoDaSkill($, skill)
  if (texto === null) ausentes.add(skill)
  else {
    carregadas.add(skill)
    entregues.add(skill)
  }
  await anota($, { evento: texto === null ? 'nao-achou' : 'carregou', skill, motivo })
  return texto === null ? null : `A skill ${skill} vem completa abaixo, já carregada pelo mod skills.\n\n${texto}`
}

function caminhoDe(e: { tool: string }): string {
  const v: unknown = Reflect.get(e, e.tool === 'NotebookEdit' ? 'notebook_path' : 'file_path')
  return typeof v === 'string' ? v : ''
}

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    const casa = await $.env.get('HOME')
    if (casa !== undefined) {
      const pasta = `${casa}/.local/state/mods/skills`
      await $.process.run(['mkdir', '-p', pasta])
      const dia = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diario = `${pasta}/${dia}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // O subagente tem contexto próprio, e a skill carregada aqui iria para a conversa principal.
    if (e.agentId !== undefined) return next(e)

    // O agente carregou a skill sozinho: o mod não entrega de novo. A que o mod já entregou não vem
    // de novo pela ferramenta, porque o texto inteiro já está na conversa.
    if (e.tool === 'Skill') {
      const pedida: unknown = Reflect.get(e, 'skill')
      if (typeof pedida === 'string' && entregues.has(pedida)) {
        return { deny: `A skill ${pedida} já veio completa pelo mod skills, mais acima nesta conversa. Siga direto dela.` }
      }
      const r = await next(e)
      const nome: unknown = Reflect.get(e, 'skill')
      if (typeof nome === 'string' && !('deny' in r) && r.isError !== true) carregadas.add(nome)
      return r
    }

    if (e.tool === 'Bash') {
      const comando: unknown = Reflect.get(e, 'command')
      const g = typeof comando === 'string' ? peloComando(comando) : null
      if (g === null || carregadas.has(g.skill)) return next(e)
      const texto = await carrega($, g.skill, 'comando')
      if (texto === null) return next(e)
      return { deny: textoDaRecusa(g.skill, 'mensagem de commit e descrição de PR', texto) }
    }

    const caminho = caminhoDe(e)
    const g = pelaFerramenta(e.tool, caminho)
    if (g === null || carregadas.has(g.skill)) return next(e)

    if (LEITURA.has(e.tool)) {
      const r = await next(e)
      if ('deny' in r || r.isError === true) return r
      const texto = await carrega($, g.skill, `leitura de ${caminho}`)
      return texto === null ? r : { ...r, context: [...(r.context ?? []), texto] }
    }
    if (ESCRITA.has(e.tool)) {
      const texto = await carrega($, g.skill, `escrita em ${caminho}`)
      if (texto === null) return next(e)
      return { deny: textoDaRecusa(g.skill, caminho, texto) }
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (AUTOMATICAS.has(e.origin.kind) || carregadas.has('diagnosing-bugs') || !pareceErro(e.text)) return next(e)
    await anota($, { evento: 'lembrou-diagnosing-bugs' })
    return next({ ...e, context: [...(e.context ?? []), LEMBRETE_DE_BUG] })
  })

  // A compactação resume a conversa, e a skill carregada antes pode sair junto.
  on('session.compact', async ($, e, next) => {
    carregadas.clear()
    entregues.clear()
    return next(e)
  })

  // `/clear`, `/resume` e `/branch` trocam a conversa sem recarregar o mod.
  on('session.end', async ($, e, next) => {
    carregadas.clear()
    entregues.clear()
    ausentes.clear()
    return next(e)
  })
}
