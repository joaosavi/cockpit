// The pipefail mod's rules, with no mods API, so the tests run them directly.

// A runner whose exit code says whether the code works: tests, type checks, lint and the repo's own
// check scripts. Matched only where it runs: at the start of the command or after `;`, `&&`, `||`,
// `|` or `(`, with optional `VAR=value` and `timeout N` in front.
const START = String.raw`(?:^|[;&|(]\s*)(?:[A-Z_]+=\S+\s+)*(?:timeout\s+\d+\s+)?`
const MANAGER = String.raw`(?:yarn(?:\s+workspace\s+\S+)?|npm\s+run|pnpm(?:\s+--filter\s+\S+)?|bun\s+run)`
// The runner alone is the first group, so the diary can name it without the rest of the command.
const RUNNER = new RegExp(
  START +
    String.raw`(` +
    String.raw`${MANAGER}\s+(?:turbo\s+run\s+)?(?:test|e2e|typecheck|lint|check|verificar|regras|vitest|playwright)\S*` +
    String.raw`|npm\s+test|(?:npx\s+|yarn\s+|bunx\s+)?(?:turbo\s+run\s+\S+|vitest|jest|playwright\s+test|tsc|vue-tsc|eslint)` +
    String.raw`|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test` +
    String.raw`)\b[^|;&]*\|\s*(?:tail|head|grep)\b`,
)

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
export function needsPipefail(command: string): boolean {
  if (/\bpipefail\b/.test(command)) return false
  return RUNNER.test(runnable(command))
}

// `2>&1` holds an `&` that is not a command separator.
function runnable(command: string): string {
  return executable(command).replace(/\s\d?>&\d/g, ' ')
}

// The runner part of a command that needs pipefail, as `yarn vitest` or `npx tsc`, without its
// arguments, so the diary groups the rewrites by runner and never holds a whole command.
export function runnerKey(command: string): string {
  const m = RUNNER.exec(runnable(command))
  return (m?.[1] ?? '').trim().replace(/\s+/g, ' ')
}

export function withPipefail(command: string): string {
  return `set -o pipefail; ${command}`
}

export const NOTE =
  'The pipefail mod ran this command with `set -o pipefail;` in front, so its exit code is the runner\'s and not the one of `tail`, `head` or `grep`. ' +
  'With `| head`, a runner that keeps writing after head closes can exit 141 (SIGPIPE): read the output before calling it a failure.'
