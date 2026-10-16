// Notices when the agent goes in circles and tells it to stop and change approach. Nothing is
// refused: the nudge is added to the tool result the agent is about to read.
//
// Three signals, counted per agent loop (the main conversation and each subagent) and reset at the
// end of each turn: fix attempts on one file (edits that follow a failed command), the same error
// coming back, and the same call repeated with the same arguments.
//
// At the end of each session, one summary line in the diary counts the tool calls the mod saw, the
// nudges by kind, and the time its tool.call hook spent outside `next`.

import type { Hook, On, PluginOptions } from 'claude-code'
import { callKey, checkKey, COMMAND_TOOLS, DEFAULTS, EDIT_TOOLS, failed, newTrack, type Nudge, nudgeText, type Options, options, signature, type Track } from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = DEFAULTS
const tracks = new Map<string, Track>()
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

function trackOf(agentId: string | undefined): Track {
  const key = agentId ?? 'main'
  const found = tracks.get(key)
  if (found !== undefined) return found
  const fresh = newTrack()
  tracks.set(key, fresh)
  return fresh
}

function filePath(e: { tool: string }): string {
  const v: unknown = Reflect.get(e, e.tool === 'NotebookEdit' ? 'notebook_path' : 'file_path')
  return typeof v === 'string' ? v : ''
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

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // One file per session, because `$.fs.write` rewrites the whole file and two sessions sharing one
    // would erase each other's lines. `$.fs.write` creates the folder with the first line.
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/loop-breaker/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) =>
    timed($, next, async (pass) => {
      const t = trackOf(e.agentId)
      const key = callKey(e)
      t.repeats = key === t.lastCall ? t.repeats + 1 : 1
      t.lastCall = key
      const fixAttempt = EDIT_TOOLS.has(e.tool) && t.failing.size > 0

      const r = await pass(e)
      if ('deny' in r) return r

      let nudge: Nudge | null = null
      const bad = failed(r)
      // Only the check that failed says the code works again. A read, an `ls` or any other command
      // between the failure and the edit keeps the edit counted as a fix attempt.
      const command: unknown = Reflect.get(e, 'command')
      if (COMMAND_TOOLS.has(e.tool) && typeof command === 'string') {
        if (bad) t.failing.add(checkKey(command))
        else t.failing.delete(checkKey(command))
      }
      if (fixAttempt && !bad) {
        const file = filePath(e)
        const count = (t.fixes.get(file) ?? 0) + 1
        t.fixes.set(file, count)
        if (count >= o.editLimit) {
          nudge = { kind: 'edits', file, count }
          t.fixes.set(file, 0)
        }
      }
      if (nudge === null && bad) {
        const sig = `${e.tool}: ${signature(r.text ?? '')}`
        const count = (t.errors.get(sig) ?? 0) + 1
        t.errors.set(sig, count)
        if (count >= o.errorLimit) {
          nudge = { kind: 'error', count }
          t.errors.set(sig, 0)
        }
      }
      if (nudge === null && t.repeats >= o.repeatLimit) {
        nudge = { kind: 'repeat', tool: e.tool, count: t.repeats }
        t.repeats = 0
      }
      if (nudge === null) return r
      countAction(tally, `nudge:${nudge.kind}`)
      await log($, { event: 'nudge', agentId: e.agentId, ...nudge })
      return { ...r, context: [...(r.context ?? []), nudgeText(nudge)] }
    }),
  )

  on('turn.complete', async ($, e, next) => {
    tracks.delete(e.agentId ?? 'main')
    return next(e)
  })

  // `/clear`, `/resume` and `/branch` switch the conversation without reloading the mod. One summary line per session.
  on('session.end', async ($, e, next) => {
    tracks.clear()
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
