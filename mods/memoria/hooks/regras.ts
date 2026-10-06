// As regras do mod memoria, sem mods API, para os testes rodarem direto.

export type Tipo = 'typecheck' | 'build' | 'teste' | 'playwright'

export type Pesado = {
  tipo: Tipo
  // O pedaço do comando que identifica o que roda, para guardar o pico medido de cada um.
  chave: string
}

export type Nivel = {
  grupo: string
  usado: number
  // `memory.high` do grupo, ou null quando é `max`.
  alto: number | null
  // `memory.max` do grupo, ou null quando é `max`.
  teto: number | null
}

export type Opcoes = {
  // Percentual do alto de cada grupo que fica livre.
  margem: number
  // Quanto tempo o comando pode esperar a memória baixar antes da recusa.
  esperaSegundos: number
}

export const PADRAO: Opcoes = { margem: 2, esperaSegundos: 120 }

const MB = 1024 * 1024
const GB = 1024 * MB

// Estimativas até o mod medir o comando. O typecheck do zippi foi medido em 1 GB. Os outros são palpite.
export const ESTIMATIVA: Record<Tipo, number> = {
  typecheck: 1 * GB,
  build: 1 * GB,
  teste: 600 * MB,
  playwright: 500 * MB,
}

// Com o paralelismo reduzido, a estimativa cai para 60% até o mod medir. Também é palpite.
export const FATOR_REDUZIDO = 0.6

export function opcoes(valores: unknown): Opcoes {
  if (typeof valores !== 'object' || valores === null) return PADRAO
  const numero = (chave: string, padrao: number): number => {
    const v: unknown = Reflect.get(valores, chave)
    return typeof v === 'number' && Number.isFinite(v) ? v : padrao
  }
  return { margem: numero('margem', PADRAO.margem), esperaSegundos: numero('esperaSegundos', PADRAO.esperaSegundos) }
}

// Cada regra casa um corredor que de fato roda, no começo do comando ou depois de `;`, `&&`, `|` ou `(`.
const INICIO = String.raw`(?:^|[;&|(]\s*)(?:[A-Z_]+=\S+\s+)*(?:timeout\s+\d+\s+)?`
// O gerenciador de pacotes, com o workspace ou o filtro que escolhe o pacote.
const GERENTE = String.raw`(?:yarn(?:\s+workspace\s+\S+)?|npm\s+run|pnpm(?:\s+--filter\s+\S+)?|bun\s+run)`
const REGRAS: Array<[Tipo, RegExp]> = [
  ['playwright', new RegExp(INICIO + String.raw`((?:npx|yarn|pnpm|bunx)\s+playwright\s+test|playwright\s+test)`)],
  ['typecheck', new RegExp(INICIO + `(${GERENTE}\\s+(?:turbo\\s+run\\s+)?typecheck|` + String.raw`(?:npx\s+|yarn\s+)?(?:turbo\s+run\s+typecheck|vue-tsc|tsc)\b(?!\s+--version))`)],
  ['build', new RegExp(INICIO + `(${GERENTE}\\s+(?:turbo\\s+run\\s+)?build|` + String.raw`(?:npx\s+|yarn\s+)?(?:turbo\s+run\s+build|next\s+build|vite\s+build))\b`)],
  ['teste', new RegExp(INICIO + `(${GERENTE}\\s+(?:turbo\\s+run\\s+)?(?:test|e2e|vitest)|npm\\s+test|` + String.raw`(?:npx\s+|yarn\s+)?(?:turbo\s+run\s+test|vitest|jest))\b`)],
]

// O comando sem corpo de heredoc e sem texto entre aspas, para não contar um `tsc` citado numa
// mensagem de commit ou num arquivo escrito com `cat <<EOF`.
export function executavel(comando: string): string {
  const linhas = comando.split('\n')
  const fora: string[] = []
  let fim: string | null = null
  for (const linha of linhas) {
    if (fim !== null) {
      if (linha.trim() === fim) fim = null
      continue
    }
    const heredoc = /<<-?\s*['"]?(\w+)['"]?/.exec(linha)
    if (heredoc?.[1] !== undefined) fim = heredoc[1]
    fora.push(linha)
  }
  return fora.join('\n').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
}

export function pesado(comando: string): Pesado | null {
  const limpo = executavel(comando)
  for (const [tipo, re] of REGRAS) {
    const m = re.exec(limpo)
    if (m?.[1] !== undefined) return { tipo, chave: m[1].replace(/\s+/g, ' ') }
  }
  return null
}

// A flag que cada corredor aceita para rodar com um processo só. O tsc não tem.
export function reduzido(comando: string, p: Pesado): string | null {
  if (/--concurrency|--maxWorkers|--workers|-w\s+\d|--pool/.test(comando)) return null
  const flag = p.chave.includes('turbo')
    ? '--concurrency=1'
    : p.tipo === 'playwright'
      ? '--workers=1'
      : /vitest|jest/.test(p.chave)
        ? '--maxWorkers=1'
        : null
  if (flag === null) return null
  // A flag entra depois da palavra inteira, para `turbo run test:unit` não virar `test --concurrency=1:unit`.
  const inicio = comando.indexOf(p.chave)
  if (inicio < 0) return null
  let fim = inicio + p.chave.length
  while (fim < comando.length && !/[\s;&|)]/.test(comando.charAt(fim))) fim += 1
  return `${comando.slice(0, fim)} ${flag}${comando.slice(fim)}`
}

// As últimas medidas de cada comando. O pico é medido no grupo inteiro, e outra sessão que sobe junto
// infla a medida. Guardar só as últimas deixa uma medida inflada sair sozinha.
export const MEDIDAS_GUARDADAS = 3

export function custo(p: Pesado, reduzida: boolean, picos: Readonly<Record<string, readonly number[]>>): number {
  const medidas = picos[chaveDoPico(p, reduzida)]
  if (medidas !== undefined && medidas.length > 0) return Math.max(...medidas)
  return reduzida ? ESTIMATIVA[p.tipo] * FATOR_REDUZIDO : ESTIMATIVA[p.tipo]
}

export function comMedida(medidas: readonly number[] | undefined, nova: number): number[] {
  return [...(medidas ?? []), nova].slice(-MEDIDAS_GUARDADAS)
}

export function chaveDoPico(p: Pesado, reduzida: boolean): string {
  return reduzida ? `${p.chave} (1 processo)` : p.chave
}

// Quanto ainda cabe sem passar do alto, menos a margem, no grupo mais apertado. Sem nenhum grupo
// com limite, como num PC, vale a memória disponível da máquina menos a margem.
export function folga(niveis: readonly Nivel[], maquina: { disponivel: number; total: number } | null, margem: number): number | null {
  const comLimite = niveis.flatMap((n) => {
    const limite = n.alto ?? n.teto
    return limite === null ? [] : [limite * (1 - margem / 100) - n.usado]
  })
  if (comLimite.length > 0) return Math.min(...comLimite)
  if (maquina === null) return null
  return maquina.disponivel - maquina.total * (margem / 100)
}

export function numeroOuMax(texto: string): number | null {
  const t = texto.trim()
  if (t === 'max') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function grupos(procCgroup: string): string[] {
  const caminho = procCgroup.trim().split('\n').find((l) => l.startsWith('0::'))?.slice(3) ?? ''
  const partes = caminho.split('/').filter((p) => p !== '')
  return partes.map((_, i) => '/' + partes.slice(0, i + 1).join('/')).reverse()
}

export function meminfo(texto: string): { disponivel: number; total: number } | null {
  const kb = (nome: string): number | null => {
    const m = new RegExp(`^${nome}:\\s+(\\d+) kB`, 'm').exec(texto)
    return m?.[1] === undefined ? null : Number(m[1]) * 1024
  }
  const disponivel = kb('MemAvailable')
  const total = kb('MemTotal')
  return disponivel === null || total === null ? null : { disponivel, total }
}

export function mb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`
}

export function morreuPorMemoria(texto: string): boolean {
  return /exit code 137|\bkilled\b.*signal 9|out of memory/i.test(texto)
}

export function quadro(niveis: readonly Nivel[], maquina: { disponivel: number; total: number } | null, margem: number): string {
  if (niveis.length === 0 && maquina === null) return 'sem leitura de memória nesta máquina'
  const linhas = niveis.map((n) => {
    const alto = n.alto === null ? 'sem alto' : `alto ${mb(n.alto)}`
    const teto = n.teto === null ? 'sem teto' : `teto ${mb(n.teto)}`
    return `${n.grupo}: usa ${mb(n.usado)}, ${alto}, ${teto}`
  })
  if (maquina !== null) linhas.push(`máquina: ${mb(maquina.disponivel)} disponíveis de ${mb(maquina.total)}`)
  const f = folga(niveis, maquina, margem)
  if (f !== null) linhas.push(`cabe ainda ${mb(Math.max(0, f))}, já descontada a margem de ${margem}%`)
  return linhas.join('\n')
}
