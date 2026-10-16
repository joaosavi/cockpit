// The loop-breaker mod's rules, with no mods API, so the tests run them directly.

export type Options = {
  // Fix attempts on one file (edits that follow a failed command) before the nudge.
  editLimit: number
  // Times the same error may come back before the nudge.
  errorLimit: number
  // Identical calls in a row before the nudge.
  repeatLimit: number
}

export const DEFAULTS: Options = { editLimit: 5, errorLimit: 3, repeatLimit: 3 }

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const num = (key: string, fallback: number): number => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  return { editLimit: num('editLimit', DEFAULTS.editLimit), errorLimit: num('errorLimit', DEFAULTS.errorLimit), repeatLimit: num('repeatLimit', DEFAULTS.repeatLimit) }
}

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const COMMAND_TOOLS = new Set(['Bash', 'PowerShell'])

// What one agent loop did in the current turn.
export type Track = {
  // The checks that failed and have not passed since. While one is failing, an edit is a fix attempt.
  failing: Set<string>
  fixes: Map<string, number>
  errors: Map<string, number>
  lastCall: string
  repeats: number
}

export function newTrack(): Track {
  return { failing: new Set(), fixes: new Map(), errors: new Map(), lastCall: '', repeats: 0 }
}

const ERROR_LINE = /error|fail|exception|traceback|panic|cannot|not found|✘|×|✗/i

// The error with what changes between runs taken out: numbers, paths, quoted values, spacing.
// Two runs of the same broken test give the same signature even with other line numbers or times.
export function signature(output: string): string {
  const lines = output.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const chosen = lines.filter((l) => ERROR_LINE.test(l)).slice(0, 3)
  const base = chosen.length > 0 ? chosen : lines.slice(-3)
  return base
    .map((l) =>
      l
        .replace(/(?:\/[\w.@-]+)+/g, '<path>')
        .replace(/0x[0-9a-f]+/gi, '<hex>')
        .replace(/\d+(\.\d+)?/g, '<n>')
        .replace(/(['"`]).*?\1/g, '<str>')
        .replace(/\s+/g, ' '),
    )
    .join(' | ')
    .slice(0, 400)
}

// One call as a comparable string: the tool and its arguments, without the fields the engine adds.
export function callKey(e: Readonly<Record<string, unknown>>): string {
  const args = Object.entries(e).filter(([k]) => k !== 'tool_use_id' && k !== 'agentId' && k !== 'consent')
  return JSON.stringify(args)
}

// Words a failing check prints even when a pipe such as `| head` hides its exit code.
const FAILURE_TEXT = /\b\w*(Error|Exception):\s|\bFAIL(ED)?\b|\b\d+ (failed|failing)\b|\bTraceback \(most recent call last\)|✘|✗/

export function failed(result: { isError?: boolean; text?: string }): boolean {
  if (result.isError === true) return true
  const text = result.text ?? ''
  return /\bexit code [1-9]\d*\b/i.test(text) || FAILURE_TEXT.test(text)
}

// The check a command runs, without what only trims its output: `yarn test 2>&1 | tail -5` and
// `yarn test` are the same check.
export function checkKey(command: string): string {
  return (command.split('|')[0] ?? '').replace(/\s*2>&1\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

export type Nudge = { kind: 'edits'; file: string; count: number } | { kind: 'error'; count: number } | { kind: 'repeat'; tool: string; count: number }

// The note added to the tool result. It starts with `Loop check`, which the hud's activity row reads.
export function nudgeText(n: Nudge): string {
  let what: string
  switch (n.kind) {
    case 'edits':
      what = `you edited ${n.file} ${n.count} times after failed commands this turn`
      break
    case 'error':
      what = `the same error came back ${n.count} times this turn`
      break
    case 'repeat':
      what = `you called ${n.tool} with the same arguments ${n.count} times in a row`
      break
    default: {
      const exhaustive: never = n
      return exhaustive
    }
  }
  return (
    `Loop check: ${what}. Stop and write in up to 3 lines what you tried and why it failed. ` +
    'Then change approach: re-read the code around the failure, test a new hypothesis, or ask the user if blocked.'
  )
}
