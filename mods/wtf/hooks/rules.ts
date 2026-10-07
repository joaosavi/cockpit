// The pure part of /wtf: the question sent to the fork, the line shown when there is no answer, and
// the cost figures the diary keeps.

import type { ModelForkResult, ModelUsage } from 'claude-code'

// The fork answers in Portuguese, because the user reads it; the instructions stay in English.
export const PROMPT = [
  'This is a side question from the user, answered apart from the task, which keeps running on its own. Do not call any tool.',
  'The user runs several sessions at once and just came back to this one. He remembers nothing about it.',
  'Tell him where this session is and what you need from him. Describe the work as it stands: if your last step was a tool call, say what that call is doing, as it may still be running. Nobody asked you to stop.',
  '',
  'Answer in Brazilian Portuguese, short and blunt, in plain words, in this format:',
  '',
  'Onde estamos: one or two sentences on the task and where it stopped.',
  'O que eu preciso de você: the concrete action you expect from the user, or "nada, sigo sozinho".',
  '',
  'If a decision or a validation is pending, add numbered options (1, 2, 3). Mark the one you recommend with "(recomendado)", and give the cost of each in one line.',
  '',
  'At most about 8 lines in total. No jargon. No file paths, unless opening or editing that file is the action itself. No preamble and no closing remarks.',
].join('\n')

// The text typed after /wtf, trimmed; empty when nothing was typed.
export function question(args: string): string {
  return args.trim()
}

// What the fork receives: the fixed instructions, plus the user's own question when he typed one.
export function prompt(q: string): string {
  if (q === '') return PROMPT
  return `${PROMPT}\n\nThe user asks this specifically. Answer it in the same format:\n<question>\n${q}\n</question>`
}

export type Outcome = 'answered' | Exclude<ModelForkResult, { isAnswered: true }>['reason'] | 'error'

export const NOTHING = 'Ainda não tem nada nesta sessão para resumir.'

// The one line /wtf shows when the fork gave no answer.
export function failureLine(r: Exclude<ModelForkResult, { isAnswered: true }>): string {
  switch (r.reason) {
    case 'nothing-to-fork':
      return NOTHING
    case 'api-error':
      return `Não consegui resumir: a API respondeu com erro (${r.status === null ? 'sem resposta' : `status ${r.status}`}, ${r.error}).`
    case 'empty-reply':
      return 'Não consegui resumir: o modelo respondeu sem texto.'
    case 'aborted':
      return 'Não consegui resumir: a chamada foi interrompida antes da resposta.'
    default: {
      const _exhaustive: never = r
      return String(_exhaustive)
    }
  }
}

// The line for an error the mod itself threw: its first line, cut short.
export function errorLine(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? ''
  return `Não consegui resumir: deu erro no mod (${text.slice(0, 160)}).`
}

export type Usage = { input: number; output: number; cacheRead: number; cacheCreation: number }

export function usage(u: ModelUsage): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens,
    cacheCreation: u.cache_creation_input_tokens,
  }
}

// The usage of a fork result; nothing-to-fork made no request and carries none.
export function resultUsage(r: ModelForkResult): Usage | null {
  return 'usage' in r ? usage(r.usage) : null
}

export function addUsage(a: Usage, b: Usage | null): Usage {
  if (b === null) return a
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreation: a.cacheCreation + b.cacheCreation }
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }

// One diary line per use. It never holds the question or the answer.
export function askedEntry(a: { hasQuestion: boolean; outcome: Outcome; ms: number; usage: Usage | null }) {
  return { event: 'asked', hasQuestion: a.hasQuestion, outcome: a.outcome, ms: Math.round(a.ms), usage: a.usage }
}
