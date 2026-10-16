// A machine-wide memory folder beside Claude Code's per-project auto memory. The memory section of the
// system prompt is rewritten to describe both folders and where each type of memory goes, and the
// global MEMORY.md joins the instruction files, so its index reaches every session from any folder,
// the way the project index does.
//
// Core decides whether memory is on and whether it is writable; the mod only adds the global folder
// in the same mode. When the global folder or its MEMORY.md is missing, both hooks pass core's
// answer through unchanged.
//
// The diary records each action, and at the end of the session one summary line with the counts.

import type { Hook, InstructionFile, On, PluginOptions } from 'claude-code'
import { globalDir, INDEX, indexContent, type Mode, rewriteSection, withGlobalIndex } from './rules.ts'
import { countAction, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let values: PluginOptions = {}
let diary = ''
let cwd = ''
let tally = newTally()
// What the memory section said last: off when core sent none, the mode when the mod rewrote it.
let memory: 'unknown' | 'off' | Mode = 'unknown'

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

async function act($: Api, action: string) {
  countAction(tally, action)
  try {
    await log($, { event: action })
  } catch {
    // a diary that cannot be written does not change the prompt
  }
}

type Global = { dir: string; index: string; raw: string }

// The global folder and its MEMORY.md, or null when either is missing.
async function loadGlobal($: Api): Promise<Global | null> {
  const dir = globalDir(values, (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')))
  if (dir === null) return null
  try {
    if ((await $.fs.stat(dir)).kind !== 'dir') return null
    const index = `${dir}/${INDEX}`
    const raw = await $.fs.read(index)
    return { dir, index, raw }
  } catch {
    return null
  }
}

export function register(on: On, options: PluginOptions) {
  values = options

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // One file per session, because `$.fs.write` rewrites the whole file and two sessions sharing one
    // would erase each other's lines. `$.fs.write` creates the folder with the first line.
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/global-memory/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  on('prompt.section', { name: 'memory' }, async ($, e, next) => {
    const r = await next(e)
    if (r.text === null) {
      memory = 'off'
      await act($, 'skipped-null')
      return r
    }
    const g = await loadGlobal($)
    if (g === null) {
      await act($, 'skipped-missing')
      return r
    }
    const out = rewriteSection(r.text, g.dir)
    if (out === null) {
      await act($, 'skipped-unrecognized')
      return r
    }
    memory = out.mode
    // Read-only keeps core's mode: the global folder is added without the save rules.
    await act($, out.mode === 'read-only' ? 'section-rewritten-read-only' : 'section-rewritten')
    return { text: out.text }
  })

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    // Left out of the answer, the files from below stand; undefined when a hook rewrote claudeMd.
    const files = r.instructionFiles ?? e.instructionFiles
    // Only an explicit off stops it. In an interactive session the context can be built before the
    // memory section, and a new project has no MEMORY.md of its own yet, so waiting for either sign
    // left the global index out (seen live on 2026-10-07). Auto memory is on by default.
    if (files === undefined || memory === 'off') return r
    const g = await loadGlobal($)
    if (g === null) {
      await act($, 'skipped-missing')
      return r
    }
    const entry: InstructionFile = { path: g.index, kind: 'memory', content: indexContent(g.raw) }
    const updated = withGlobalIndex(files, entry)
    if (updated === files) return r
    await act($, 'context-injected')
    return { ...r, instructionFiles: updated }
  })

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
