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
import { expandHome, globalDir, INDEX, indexBody, indexContent, metaProject, type Mode, parseSection, rewriteSection, scopeOf, scopePath, WIKI_GLOBAL, WIKI_INDEX, wikiDir, type WikiScope, wikiSection, withGlobalIndex } from './rules.ts'
import { type Hit, indexLines, indexWarning, isMemoryPage, keywords, type Page, pageBody, RECALL_DEFAULTS, rankPages, recallContext, skipReason } from './recall.ts'
import { countAction, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let values: PluginOptions = {}
let diary = ''
let cwd = ''
let tally = newTally()
// What the memory section said last: off when core sent none, the mode when the mod rewrote it.
let memory: 'unknown' | 'off' | Mode = 'unknown'
// The wiki project of this session's memory folder, read from the memory section; null when the folder
// links to no wiki project, and recall then searches _global only.
let recallProject: string | null = null
// Pages recall already put in this conversation, by project and path. Cleared when the conversation is
// compacted or ends, because the summary drops them.
const injected = new Set<string>()
// Wiki project folders by name, found once per session: finding one reads every project's _meta.md.
const projectDirs = new Map<string, string | null>()

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
  const known = projectDirs.get(project)
  if (known !== undefined) return known
  const wiki = wikiDir(values, await home($))
  if (wiki === null) return null
  try {
    for (const ws of await $.fs.list(wiki)) {
      if (ws.kind !== 'dir') continue
      for (const p of await $.fs.list(`${wiki}/${ws.name}`)) {
        if (p.kind !== 'dir') continue
        const dir = `${wiki}/${ws.name}/${p.name}`
        const meta = await $.fs.read(`${dir}/_meta.md`).catch(() => '')
        const name = metaProject(meta)
        if (name !== null && !projectDirs.has(name)) projectDirs.set(name, dir)
        if (name === project) return dir
      }
    }
  } catch {
    // an unreadable wiki falls back to MEMORY.md
    return null
  }
  projectDirs.set(project, null)
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

// An index as the agent gets it, with the mod's warning when it breaks the limits.
function guardedIndex(raw: string): { content: string; over: boolean } {
  const content = indexContent(raw)
  const warning = indexWarning(indexBody(raw))
  return warning === null ? { content, over: false } : { content: `${content}\n${warning}`, over: true }
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
    const guarded = guardedIndex(page.raw)
    if (guarded.over) await act($, 'index-over-limit')
    out.push({ ...f, path: page.path, content: guarded.content })
    changed = true
  }
  return changed ? out : files
}

// The ai-memory workspace the server files every project under unless told otherwise.
// Origins of a prompt a person or the host app sent; the others are timers, agents and plugins.
const REQUEST_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'channel', 'sdk'])
const WORKSPACE = 'default'
const SEARCH_TIMEOUT_MS = 5000

// One memory_query through the ai-memory CLI, which reaches the local server with its own credentials.
// Null when the command is missing, fails, or answers something that is not JSON.
async function memoryQuery($: Api, args: Record<string, unknown>): Promise<unknown> {
  const raw = typeof values.aiMemoryCommand === 'string' && values.aiMemoryCommand.trim() !== '' ? values.aiMemoryCommand.trim() : 'ai-memory'
  const cmd = expandHome(raw, await home($)) ?? raw
  try {
    const r = await $.process.run([cmd, 'call', 'memory_query', JSON.stringify(args)], { env: { RUST_LOG: 'error' }, timeoutMs: SEARCH_TIMEOUT_MS })
    if (r.exitCode !== 0 || r.isStdoutTruncated) return null
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}

// The hits of one list in a memory_query answer, kept to memory pages of the allowed projects. A hit
// without a project name takes `project`, as the project search's own hits do.
function hitsOf(answer: unknown, list: string, allowed: ReadonlySet<string>, project?: string): Hit[] {
  if (typeof answer !== 'object' || answer === null || !(list in answer)) return []
  const items: unknown = Reflect.get(answer, list)
  if (!Array.isArray(items)) return []
  const out: Hit[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const path: unknown = Reflect.get(item, 'path')
    const rank: unknown = Reflect.get(item, 'rank')
    const named: unknown = Reflect.get(item, 'project_name')
    const name = typeof named === 'string' ? named : project
    if (typeof path !== 'string' || typeof rank !== 'number' || name === undefined) continue
    if (allowed.has(name) && isMemoryPage(path)) out.push({ project: name, path, rank })
  }
  return out
}

function maxTokens(): number {
  const v = Number(values.recallMaxTokens)
  return Number.isFinite(v) && v > 0 ? v : RECALL_DEFAULTS.maxTokens
}

// The recall block for one prompt, or why there is none.
async function recall($: Api, text: string): Promise<{ block: string; paths: string[]; tokens: number } | { skip: string }> {
  const skip = skipReason(text)
  if (skip !== null) return { skip: `recall-skipped-${skip}` }
  const words = keywords(text)
  const query = words.join(' ')
  const project = recallProject ?? WIKI_GLOBAL
  const allowed = new Set([project, WIKI_GLOBAL])
  const [all, scoped] = await Promise.all([
    memoryQuery($, { query, global: true, limit: 30 }),
    memoryQuery($, { query, workspace: WORKSPACE, project, limit: 15 }),
  ])
  if (all === null && scoped === null) return { skip: 'recall-failed' }
  const lines = new Map<string, string>()
  for (const name of allowed) {
    const page = await wikiIndex($, name)
    if (page !== null) for (const [k, v] of indexLines(page.raw)) lines.set(k, v)
  }
  const ranked = rankPages({
    words,
    text: hitsOf(all, 'global_hits', allowed),
    fused: [...hitsOf(scoped, 'hits', allowed, project), ...hitsOf(scoped, 'global_scope_hits', allowed, WIKI_GLOBAL)],
    lines,
    max: RECALL_DEFAULTS.pages,
  })
  const pages: Page[] = []
  for (const h of ranked) {
    if (injected.has(`${h.project}\n${h.path}`)) continue
    const dir = await wikiProject($, h.project)
    const raw = dir === null ? null : await $.fs.read(`${dir}/${h.path}`).catch(() => null)
    if (raw !== null) pages.push({ project: h.project, path: h.path, body: pageBody(raw) })
  }
  const r = recallContext(pages, maxTokens())
  if (r === null) return { skip: 'recall-none' }
  for (const p of pages) if (r.paths.includes(p.path)) injected.add(`${p.project}\n${p.path}`)
  return { block: r.text, paths: r.paths, tokens: r.tokens }
}

export function register(on: On, options: PluginOptions) {
  values = options
  injected.clear()
  projectDirs.clear()
  recallProject = null
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
    recallProject = project?.project ?? null
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
    const guarded = g.index.endsWith(WIKI_INDEX) ? guardedIndex(g.raw) : { content: indexContent(g.raw), over: false }
    if (guarded.over) await act($, 'index-over-limit')
    const entry: InstructionFile = { path: g.index, kind: 'memory', content: guarded.content }
    const projects = await withWikiProjects($, files, g.index)
    const updated = withGlobalIndex(projects, entry)
    if (updated === files) return r
    if (projects !== files) await act($, 'project-from-wiki')
    if (updated !== projects) await act($, g.index.endsWith(WIKI_INDEX) ? 'context-injected-wiki' : 'context-injected')
    return { ...r, instructionFiles: updated }
  })

  // Recall: the pages that match the request go in with it. Only a prompt from a person or the host app
  // searches; a scheduled or agent message does not. Needs the wiki on disk to read the pages.
  on('prompt.submit', async ($, e, next) => {
    if (values.recall === false || !REQUEST_ORIGINS.has(e.origin.kind) || wikiDir(values, await home($)) === null) return next(e)
    const began = await $.clock.now()
    const r = await recall($, e.text).catch(() => ({ skip: 'recall-failed' }))
    const ms = (await $.clock.now()) - began
    if ('skip' in r) {
      countAction(tally, r.skip)
      await log($, { event: r.skip, ms }).catch(() => undefined)
      return next(e)
    }
    countAction(tally, 'recall-injected')
    await log($, { event: 'recall-injected', pages: r.paths, tokens: r.tokens, ms }).catch(() => undefined)
    return next({ ...e, context: [...(e.context ?? []), r.block] })
  })

  // Compaction summarizes the conversation, and the pages recall put in may drop out with it.
  on('session.compact', async ($, e, next) => {
    injected.clear()
    return next(e)
  })

  // One summary line per session. `/clear`, `/resume` and `/branch` end a session without reloading the mod.
  on('session.end', async ($, e, next) => {
    const t = tally
    tally = newTally()
    injected.clear()
    try {
      await log($, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
