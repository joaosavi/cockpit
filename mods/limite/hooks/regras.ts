// As regras do mod limite, sem mods API, para os testes rodarem direto.

export type Janela = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type Faixa =
  | { kind: 'livre' }
  | { kind: 'contida'; janela: Janela }
  | { kind: 'pausada'; janela: Janela }

export type Opcoes = {
  // Abaixo de 100 - reserva, a sessão trabalha. Acima, pausa.
  reserva: number
  // Acima deste percentual, só um subagente roda por vez.
  alerta: number
  // Fuso dos horários que o agente e o João leem.
  fuso: string
  // Retoma também a sessão que bateu 100% com o erro de limite. Fica desligado enquanto o
  // retomar-limite.timer da VPS cuida desse caso.
  retomarNoErro: boolean
}

export const PADRAO: Opcoes = { reserva: 2, alerta: 90, fuso: 'America/Sao_Paulo', retomarNoErro: false }

// Margem depois do horário de volta, porque o servidor pode liberar com alguns segundos de atraso.
export const MARGEM_MS = 2 * 60_000

export function opcoes(valores: unknown): Opcoes {
  if (typeof valores !== 'object' || valores === null) return PADRAO
  const numero = (chave: string, padrao: number): number => {
    const v: unknown = Reflect.get(valores, chave)
    return typeof v === 'number' && Number.isFinite(v) ? v : padrao
  }
  const fuso: unknown = Reflect.get(valores, 'fuso')
  const retomar: unknown = Reflect.get(valores, 'retomarNoErro')
  return {
    reserva: numero('reserva', PADRAO.reserva),
    alerta: numero('alerta', PADRAO.alerta),
    fuso: typeof fuso === 'string' && fuso !== '' ? fuso : PADRAO.fuso,
    retomarNoErro: typeof retomar === 'boolean' ? retomar : PADRAO.retomarNoErro,
  }
}

// A janela mais cheia decide a faixa, porque qualquer uma delas que chegue a 100% para a conta.
export function maisCheia(janelas: readonly Janela[]): Janela | null {
  return janelas.reduce<Janela | null>((a, j) => (a === null || j.percentUsed > a.percentUsed ? j : a), null)
}

export function classifica(janelas: readonly Janela[], o: Pick<Opcoes, 'reserva' | 'alerta'>): Faixa {
  const cheia = maisCheia(janelas)
  if (cheia === null) return { kind: 'livre' }
  if (cheia.percentUsed >= 100 - o.reserva) return { kind: 'pausada', janela: cheia }
  if (cheia.percentUsed >= o.alerta) return { kind: 'contida', janela: cheia }
  return { kind: 'livre' }
}

const NOMES: Record<string, string> = { five_hour: 'de 5 horas', seven_day: 'de 7 dias' }

export function nomeDaJanela(kind: string): string {
  return NOMES[kind] ?? kind
}

export function hora(iso: string, fuso: string): string {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' })
  const h = d.toLocaleTimeString('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' })
  return `${dia} às ${h}`
}

export function msAteVoltar(janela: Janela, agora: number): number | null {
  if (janela.resetsAt === undefined) return null
  return Math.max(0, Date.parse(janela.resetsAt) - agora) + MARGEM_MS
}

export function textoDaPausa(janela: Janela, o: Opcoes): string {
  const volta = janela.resetsAt === undefined ? 'quando o limite voltar' : `em ${hora(janela.resetsAt, o.fuso)}`
  return (
    `Pausado pelo mod limite: a janela ${nomeDaJanela(janela.kind)} da conta está em ${janela.percentUsed}%, ` +
    `e os ${o.reserva}% finais ficam de reserva para o João. Não chame mais ferramentas. ` +
    `Escreva em até 3 linhas onde parou e o que falta. A sessão retoma sozinha ${volta}.`
  )
}

export function textoDoTurnoNaReserva(janela: Janela): string {
  return (
    `O limite de uso da conta está em ${janela.percentUsed}% (janela ${nomeDaJanela(janela.kind)}), ` +
    'e este turno gasta a reserva do João. Responda direto, sem subagente, e leia só o trecho que precisar.'
  )
}

export function textoDaRetomada(janela: Janela, fila: readonly string[]): string {
  const base =
    `Esta sessão pausou quando a janela ${nomeDaJanela(janela.kind)} do limite de uso chegou a ` +
    `${janela.percentUsed}%, para guardar a reserva do João. O limite voltou. Continue de onde parou, ` +
    'com no máximo um subagente por vez, e lendo trechos em vez de arquivos inteiros.'
  if (fila.length === 0) return base
  const recebidas = fila.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `${base}\n\nDurante a pausa chegaram estas mensagens, que ficaram guardadas:\n${recebidas}`
}

export function resumo(janelas: readonly Janela[], faixa: Faixa, o: Opcoes): string {
  if (janelas.length === 0) return 'sem leitura ainda. A primeira resposta do modelo traz o percentual.'
  const linhas = janelas.map((j) => {
    const volta = j.resetsAt === undefined ? '' : `, volta ${hora(j.resetsAt, o.fuso)}`
    return `janela ${nomeDaJanela(j.kind)}: ${j.percentUsed}%${volta}`
  })
  const estado =
    faixa.kind === 'pausada'
      ? `pausada em ${100 - o.reserva}%`
      : faixa.kind === 'contida'
        ? `contida acima de ${o.alerta}%, um subagente por vez`
        : 'livre'
  return [estado, ...linhas].join('\n')
}

// O que chega sem ninguém digitar: routine, aviso de tarefa, outra sessão, canal do MCP, outro
// plugin. Isso fica guardado para a retomada. O resto conta como do João e usa a reserva, inclusive a
// origem que o Claude Code não soube classificar: gastar um pouco da reserva custa menos do que
// engolir uma mensagem dele.
const AUTOMATICAS = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'plugin',
])

export function ehAutomatico(origem: { kind: string } | undefined): boolean {
  return origem !== undefined && AUTOMATICAS.has(origem.kind)
}

export type Leitura = { em: number; janelas: Janela[] }

function ehJanela(v: unknown): v is Janela {
  if (typeof v !== 'object' || v === null) return false
  const kind: unknown = Reflect.get(v, 'kind')
  const pct: unknown = Reflect.get(v, 'percentUsed')
  const volta: unknown = Reflect.get(v, 'resetsAt')
  return typeof kind === 'string' && typeof pct === 'number' && (volta === undefined || typeof volta === 'string')
}

// A leitura que outra sessão guardou. A janela que já voltou sai, porque o percentual dela zerou.
export function leitura(v: unknown, agora: number): Leitura | null {
  if (typeof v !== 'object' || v === null) return null
  const em: unknown = Reflect.get(v, 'em')
  const lista: unknown = Reflect.get(v, 'janelas')
  if (typeof em !== 'number' || !Array.isArray(lista)) return null
  const janelas = semVencidas(lista.filter(ehJanela), agora)
  return { em, janelas }
}

// Tira as janelas cujo horário de volta já passou, porque o percentual delas zerou.
export function semVencidas(janelas: readonly Janela[], agora: number): Janela[] {
  return janelas.filter((j) => j.resetsAt === undefined || Date.parse(j.resetsAt) > agora)
}
