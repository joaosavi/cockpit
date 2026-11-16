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
import { globalDir, INDEX, indexContent, metaProject, type Mode, parseSection, rewriteSection, scopeOf, scopePath, WIKI_GLOBAL, WIKI_INDEX, wikiDir, type WikiScope, wikiSection, withGlobalIndex } from './rules.ts'
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
type Page = { path: string; raw: string }

async function home($: Api): Promise<string | undefined> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
}

// The folder of one ai-memory project in the wiki on disk, found by the `project:` line of each
// folder's _meta.md; null when `wikiDir` is unset or the project is not there.
async function wikiProject($: Api, project: string): Promise<string | null> {
  const wiki = wikiDir(values, await home($))
  if (wiki === null) return null
  try {
    for (const ws of await $.fs.list(wiki)) {
      if (ws.kind !== 'dir') continue
      for (const p of await $.fs.list(`${wiki}/${ws.name}`)) {
        if (p.kind !== 'dir') continue
        const dir = `${wiki}/${ws.name}/${p.name}`
        const meta = await $.fs.read(`${dir}/_meta.md`).catch(() => '')
        if (metaProject(meta) === project) return dir
      }
    }
  } catch {
    // an unreadable wiki falls back to MEMORY.md
  }
  return null
}

// The index page of one ai-memory project; null when the project or its page is missing. The caller
// then keeps MEMORY.md.
async function wikiIndex($: Api, project: string): Promise<Page | null> {
  const dir = await wikiProject($, project)
  if (dir === null) return null
  const path = `${dir}/${WIKI_INDEX}`
  try {
    return { path, raw: await $.fs.read(path) }
  } catch {
    return null
  }
}

// The wiki scope a memory folder stands for, through the folder it resolves to; null when it is not
// a link or its project is not in the wiki.
async function wikiScopeOf($: Api, folder: string, project?: string): Promise<WikiScope | null> {
  const real = (await $.fs.stat(folder.replace(/[\\/]+$/, ''), { resolve: true }).catch(() => undefined))?.realPath
  if (real === undefined) return null
  const name = project ?? scopeOf(real)
  if (name === null || (await wikiProject($, name)) === null) return null
  return { project: name, prefix: scopePath(real) }
}

// The global folder and its index: the wiki's _global index when there is one, else the folder's
// MEMORY.md. Null when the folder is missing, or when neither index is there.
async function loadGlobal($: Api): Promise<Global | null> {
  const dir = globalDir(values, await home($))
  if (dir === null) return null
  try {
    if ((await $.fs.stat(dir)).kind !== 'dir') return null
  } catch {
    return null
  }
  const wiki = await wikiIndex($, WIKI_GLOBAL)
  if (wiki !== null) return { dir, index: wiki.path, raw: wiki.raw }
  try {
    const index = `${dir}/${INDEX}`
    return { dir, index, raw: await $.fs.read(index) }
  } catch {
    return null
  }
}

// Core's project MEMORY.md swapped for the wiki index of the scope its folder links to. A project
// folder that is not a link, or a scope without a wiki index, keeps core's entry.
async function withWikiProjects($: Api, files: readonly InstructionFile[], globalIndex: string): Promise<readonly InstructionFile[]> {
  if (wikiDir(values, await home($)) === null) return files
  let changed = false
  const out: InstructionFile[] = []
  for (const f of files) {
    const cut = f.path.length - INDEX.length - 1
    if (f.kind !== 'memory' || f.path === globalIndex || !f.path.endsWith(INDEX) || cut <= 0) {
      out.push(f)
      continue
    }
    const real = (await $.fs.stat(f.path.slice(0, cut), { resolve: true }).catch(() => undefined))?.realPath
    const scope = real === undefined ? null : scopeOf(real)
    const page = scope === null ? null : await wikiIndex($, scope)
    if (page === null) {
      out.push(f)
      continue
    }
    out.push({ ...f, path: page.path, content: indexContent(page.raw) })
    changed = true
  }
  return changed ? out : files
}

export function register(on: On, options: PluginOptions) {
  values = options
  // Off, the mod registers no hook, and the memory section stays as Claude Code wrote it.
  if (values.enabled === false) return

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // One file per session, because `$.fs.write` rewrites the whole file and two sessions sharing one
    // would erase each other's lines. `$.fs.write` creates the folder with the first line.
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const h = await home($)
    if (h !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${h}/.local/state/mods/global-memory/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
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
    // With the wiki in place, the save rules point at it; without it, the two-folder rewrite.
    const wikiGlobal = await wikiScopeOf($, g.dir, WIKI_GLOBAL)
    const projectDir = wikiGlobal === null ? undefined : parseSection(r.text)?.projectDir
    const project = projectDir === undefined ? null : await wikiScopeOf($, projectDir)
    const out = wikiGlobal === null ? rewriteSection(r.text, g.dir) : wikiSection(r.text, g.dir, wikiGlobal, project)
    if (out === null) {
      await act($, 'skipped-unrecognized')
      return r
    }
    memory = out.mode
    // Read-only keeps core's mode: the global folder is added without the save rules.
    await act($, out.mode === 'read-only' ? 'section-rewritten-read-only' : wikiGlobal === null ? 'section-rewritten' : 'section-wiki')
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
    const projects = await withWikiProjects($, files, g.index)
    const updated = withGlobalIndex(projects, entry)
    if (updated === files) return r
    if (projects !== files) await act($, 'project-from-wiki')
    if (updated !== projects) await act($, g.index.endsWith(WIKI_INDEX) ? 'context-injected-wiki' : 'context-injected')
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
