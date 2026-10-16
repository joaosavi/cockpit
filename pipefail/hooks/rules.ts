// The pipefail mod's rules, with no mods API, so the tests run them directly.

export type Options = {
  // Script names that also count as runners when a package manager calls them, such as a repo's own
  // `check-all` script: `yarn check-all`, `npm run check-all`, `pnpm check-all`, `bun run check-all`.
  extraRunners: readonly string[]
}

export const DEFAULTS: Options = { extraRunners: [] }

// A script name as package.json allows it. Anything else is dropped rather than put in a regex.
const SCRIPT_NAME = /^[\w@:./-]+$/

// The option as a list: an array from `multiple`, or a comma or space separated string.
export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const raw: unknown = Reflect.get(values, 'extraRunners')
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : []
  const names = items.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => SCRIPT_NAME.test(v))
  return { extraRunners: [...new Set(names)] }
}

// A runner whose exit code says whether the code works: tests, type checks, lint, and the extra script
// names from the options. Matched only where it runs: at the start of the command or after `;`, `&&`,
// `||`, `|` or `(`, with optional `VAR=value` and `timeout N` in front.
const START = String.raw`(?:^|[;&|(]\s*)(?:[A-Z_]+=\S+\s+)*(?:timeout\s+\d+\s+)?`
const MANAGER = String.raw`(?:yarn(?:\s+workspace\s+\S+)?|npm\s+run|pnpm(?:\s+--filter\s+\S+)?|bun\s+run)`
const SCRIPTS = ['test', 'e2e', 'typecheck', 'lint', 'check', 'vitest', 'playwright']

function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The runner alone is the first group, so the diary can name it without the rest of the command.
function runnerPattern(extra: readonly string[]): RegExp {
  const scripts = [...SCRIPTS, ...extra.map(escape)].join('|')
  return new RegExp(
    START +
      String.raw`(` +
      String.raw`${MANAGER}\s+(?:turbo\s+run\s+)?(?:${scripts})\S*` +
      String.raw`|npm\s+test|(?:npx\s+|yarn\s+|bunx\s+)?(?:turbo\s+run\s+\S+|vitest|jest|playwright\s+test|tsc|vue-tsc|eslint)` +
      String.raw`|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test` +
      String.raw`)\b[^|;&]*\|\s*(?:tail|head|grep)\b`,
  )
}

// One pattern per list of extra names, built once.
const patterns = new Map<string, RegExp>()
function runner(extra: readonly string[]): RegExp {
  const key = extra.join('\n')
  let re = patterns.get(key)
  if (re === undefined) {
    re = runnerPattern(extra)
    patterns.set(key, re)
  }
  return re
}

// The command without heredoc bodies and quoted text, so a `vitest | tail` quoted in a commit
// message or written into a file with `cat <<EOF` does not count.
export function executable(command: string): string {
  const out: string[] = []
  let end: string | null = null
  for (const row of command.split('\n')) {
    if (end !== null) {
      if (row.trim() === end) end = null
      continue
    }
    const heredoc = /<<-?\s*['"]?(\w+)['"]?/.exec(row)
    if (heredoc?.[1] !== undefined) end = heredoc[1]
    out.push(row)
  }
  return out.join('\n').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
}

// Whether the command pipes a runner into `tail`, `head` or `grep` without pipefail, so the
// pipeline's exit code is the filter's and a failing test exits 0.
export function needsPipefail(command: string, extra: readonly string[] = []): boolean {
  if (/\bpipefail\b/.test(command)) return false
  return runner(extra).test(runnable(command))
}

// `2>&1` holds an `&` that is not a command separator.
function runnable(command: string): string {
  return executable(command).replace(/\s\d?>&\d/g, ' ')
}

// The runner part of a command that needs pipefail, as `yarn vitest` or `npx tsc`, without its
// arguments, so the diary groups the rewrites by runner and never holds a whole command.
export function runnerKey(command: string, extra: readonly string[] = []): string {
  const m = runner(extra).exec(runnable(command))
  return (m?.[1] ?? '').trim().replace(/\s+/g, ' ')
}

export function withPipefail(command: string): string {
  return `set -o pipefail; ${command}`
}

export const NOTE =
  'pipefail: ran with `set -o pipefail;`, so the exit code is the runner\'s, not that of `tail`, `head` or `grep`. ' +
  'With `| head`, exit 141 (SIGPIPE) can mean head closed early: read the output before calling it a failure.'
