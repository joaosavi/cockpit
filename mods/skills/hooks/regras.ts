// As regras do mod skills, sem mods API, para os testes rodarem direto.

export type Gatilho = {
  skill: string
  // Arquivo que, lido, editado ou escrito, pede a skill.
  caminho?: RegExp
  // Comando de Bash que pede a skill antes de rodar.
  comando?: RegExp
}

// Substitui a seção "Skills que você carrega na hora" do CLAUDE.md global.
export const GATILHOS: readonly Gatilho[] = [
  { skill: 'typescript-best-practices', caminho: /\.(ts|tsx|mts|cts)$/ },
  { skill: 'writing-for-agents', caminho: /(^|\/)(SKILL|AGENTS|CLAUDE)\.md$/ },
  { skill: 'domain-modeling', caminho: /(^|\/)CONTEXT(-MAP)?\.md$|(^|\/)(adr|adrs|decisions)\/[^/]+\.md$/i },
  { skill: 'technical-writing', caminho: /(^|\/)README[^/]*\.md$/i, comando: /(^|[;&|(]\s*)(git\s+commit\b|gh\s+pr\s+(create|edit)\b)/ },
]

export const LEITURA = new Set(['Read'])
export const ESCRITA = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export function pelaFerramenta(tool: string, caminho: string): Gatilho | null {
  if (!LEITURA.has(tool) && !ESCRITA.has(tool)) return null
  return GATILHOS.find((g) => g.caminho?.test(caminho) === true) ?? null
}

// O comando sem corpo de heredoc e sem texto entre aspas, para não contar um `git commit` citado.
function executavel(comando: string): string {
  const fora: string[] = []
  let fim: string | null = null
  for (const linha of comando.split('\n')) {
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

export function peloComando(comando: string): Gatilho | null {
  const limpo = executavel(comando)
  return GATILHOS.find((g) => g.comando?.test(limpo) === true) ?? null
}

// Sinais de que o João colou um erro ou disse que algo quebrou.
const SINAIS_DE_ERRO = [
  /\b\w*(Error|Exception):\s/,
  /Traceback \(most recent call last\)/,
  /^\s+at\s+\S+.*:\d+:\d+\)?$/m,
  /\bexit code [1-9]\d*\b/i,
  /\b(quebrou|quebrado|parou de funcionar|não funciona|nao funciona|deu erro|tá dando erro|ta dando erro)\b/i,
]

export function pareceErro(texto: string): boolean {
  return SINAIS_DE_ERRO.some((re) => re.test(texto))
}

export const LEMBRETE_DE_BUG =
  'O João colou um erro ou disse que algo quebrou. Antes de investigar, carregue a skill diagnosing-bugs.'

export function textoDaRecusa(skill: string, alvo: string, texto: string): string {
  return `O mod skills não rodou esta chamada: antes, siga a skill ${skill}, que vale para ${alvo} e vem abaixo. Refaça a mesma chamada seguindo ela.\n\n${texto}`
}

// O SKILL.md como a ferramenta Skill entrega: a pasta da skill, para os caminhos relativos, e o corpo sem o frontmatter.
export function comoSkill(dir: string, conteudo: string): string {
  const corpo = conteudo.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
  return `Base directory for this skill: ${dir}\n\n${corpo}`
}
