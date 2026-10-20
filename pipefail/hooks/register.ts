// Puts `set -o pipefail;` in front of a command that pipes a test, type check or lint runner into
// `tail`, `head` or `grep`. Without it the pipeline exits with the filter's code, and a failing test
// reads as a pass. Rewriting instead of refusing saves the agent a round, and a repo guard that
// refuses such pipes accepts the rewritten command.
//
// The diary records each rewrite by runner (`yarn vitest`, never the whole command), and at the end
// of the session one summary line with the calls seen, the rewrites, and the hook's own time.

import type { Hook, On, PluginOptions } from 'claude-code'
import { DEFAULTS, needsPipefail, NOTE, type Options, options, runnerKey, withPipefail } from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = DEFAULTS
let diary = ''
let cwd = ''
let tally = newTally()

// One diary line. Every mod's diary line starts with `at`, `session` and `event`. The session id is read
// on each write, because `/clear` and `/resume` change it without reloading the mod.
async function log($: Api, entry: Record<string, unknown>) {
  if (diary === '') return
  let before = ''
  try {
    before = await $.fs.read(diary)
  } catch {
    // the diary's first line
  }
  const at = new Date(await $.clock.now()).toISOString()
  const session = (await $.session.id()).slice(0, 8)
  await $.fs.write(diary, before + JSON.stringify({ at, session, ...entry }) + '\n')
}

// Runs the tool.call hook's body and adds its own wall time, outside `next`, to the session tally.
async function timed<I, R>($: Api, next: (input: I) => Promise<R>, body: (pass: (input: I) => Promise<R>) => Promise<R>): Promise<R> {
  const started = await $.clock.now()
  let inside = 0
  const pass = async (input: I): Promise<R> => {
    const at = await $.clock.now()
    try {
      return await next(input)
    } finally {
      inside += (await $.clock.now()) - at
    }
  }
  try {
    return await body(pass)
  } finally {
    countCall(tally, (await $.clock.now()) - started - inside)
  }
}

export function register(on: On, values: PluginOptions) {
  o = options(values)
  if (!o.enabled) return

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // One file per session, because `$.fs.write` rewrites the whole file and two sessions sharing one
    // would erase each other's lines. `$.fs.write` creates the folder with the first line.
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/pipefail/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) =>
    timed($, next, async (pass) => {
      const command: unknown = Reflect.get(e, 'command')
      if (typeof command !== 'string' || !needsPipefail(command, o.extraRunners)) return pass(e)
      const key = runnerKey(command, o.extraRunners)
      countAction(tally, 'rewritten')
      await log($, { event: 'rewritten', key })
      const r = await pass({ ...e, command: withPipefail(command) })
      if ('deny' in r) return r
      return { ...r, context: [...(r.context ?? []), NOTE] }
    }),
  )

  // One summary line per session. `/clear`, `/resume` and `/branch` end a session without reloading the mod.
  on('session.end', async ($, e, next) => {
    const t = tally
    tally = newTally()
    try {
      await log($, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
