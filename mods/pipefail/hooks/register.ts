// Puts `set -o pipefail;` in front of a command that pipes a test, type check or lint runner into
// `tail`, `head` or `grep`. Without it the pipeline exits with the filter's code, and a failing test
// reads as a pass. Rewriting instead of refusing saves the agent a round, and a repo guard that
// refuses such pipes (like zippi's guard-bash.sh) accepts the rewritten command.

import type { On } from 'claude-code'
import { needsPipefail, NOTE, withPipefail } from './rules.ts'

export function register(on: On) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command: unknown = Reflect.get(e, 'command')
    if (typeof command !== 'string' || !needsPipefail(command)) return next(e)
    const r = await next({ ...e, command: withPipefail(command) })
    if ('deny' in r) return r
    return { ...r, context: [...(r.context ?? []), NOTE] }
  })
}
