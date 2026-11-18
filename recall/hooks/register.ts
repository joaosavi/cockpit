// Recall: each request from a person is searched in the ai-memory server, and the pages that match best go
// in with it, under a note that they are the hook's suggestions. The server is reached through the
// ai-memory CLI (`ai-memory call`), locally or through a tunnel to its port; when that fails, through an
// MCP gateway that serves the same tools. ai-memory's own hooks capture the session and brief it at
// start; they add no page per request, which is the gap this mod fills.
//
// The diary records each request it searched and why it added nothing, and at the end of the session one
// summary line with the counts.

import type { Hook, On, PluginOptions } from 'claude-code'
import { type Hit, isMemoryPage, keywords, type Page, pageBody, projectsAt, RECALL_DEFAULTS, rankPages, recallContext, skipReason, tomlProject } from './recall.ts'
import { countAction, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let values: PluginOptions = {}
let diary = ''
let cwd = ''
let tally = newTally()
// Pages recall already put in this conversation, by project and path. Cleared when the conversation is
// compacted or ends, because the summary drops them.
const injected = new Set<string>()
// The session's wiki projects, read once per session.
let sessionProjects: string[] | null = null
// Wiki project folders by name, found once per session: finding one reads every project's _meta.md.
const projectDirs = new Map<string, string | null>()

// Origins of a prompt a person or the host app sent; the others are timers, agents and plugins.
const REQUEST_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'channel', 'sdk'])
// The ai-memory workspace the server files every project under unless told otherwise.
const WORKSPACE = 'default'
const GLOBAL = '_global'
const SEARCH_TIMEOUT_MS = 5000

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

async function home($: Api): Promise<string | undefined> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
}

// `~`, `~/...` and Windows' `~\\...` resolved against HOME; the path unchanged when HOME is missing.
function expandHome(path: string, h: string | undefined): string {
  if (h === undefined || (path !== '~' && !path.startsWith('~/') && !path.startsWith('~\\'))) return path
  return h.replace(/[\\/]+$/, '') + path.slice(1)
}

function option(name: string): string | null {
  const v = values[name]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function argv(cmd: string, h: string | undefined): string[] {
  const [first, ...rest] = cmd.split(/\s+/).filter((w) => w !== '')
  return first === undefined ? [] : [expandHome(first, h), ...rest]
}

// The ways to reach the ai-memory tools, in the order recall tries them: the CLI, then the gateway.
type Route = { argv: string[]; prefix: string }

async function routes($: Api): Promise<Route[]> {
  const h = await home($)
  const out: Route[] = [{ argv: [...argv(option('aiMemoryCommand') ?? 'ai-memory', h), 'call'], prefix: '' }]
  const gateway = option('gatewayCommand')
  if (gateway !== null) out.push({ argv: argv(gateway, h), prefix: option('gatewayToolPrefix') ?? 'memoria_' })
  return out
}

// One ai-memory tool call on one route. Null when the command fails or answers something that is not JSON.
async function memoryTool($: Api, route: Route, tool: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const r = await $.process.run([...route.argv, `${route.prefix}${tool}`, JSON.stringify(args)], { env: { RUST_LOG: 'error' }, timeoutMs: SEARCH_TIMEOUT_MS })
    if (r.exitCode !== 0 || r.isStdoutTruncated) return null
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}

function field(item: unknown, key: string): unknown {
  return typeof item === 'object' && item !== null ? Reflect.get(item, key) : undefined
}

// The hits of one list in a memory_query answer, kept to memory pages of the allowed projects. A hit
// without a project name takes `project`, as the project search's own hits do. Titles go to `titles`.
function hitsOf(answer: unknown, list: string, allowed: ReadonlySet<string>, titles: Map<string, string>, project?: string): Hit[] {
  const items = field(answer, list)
  if (!Array.isArray(items)) return []
  const out: Hit[] = []
  for (const item of items) {
    const path = field(item, 'path')
    const rank = field(item, 'rank')
    const named = field(item, 'project_name')
    const title = field(item, 'title')
    const name = typeof named === 'string' ? named : project
    if (typeof path !== 'string' || typeof rank !== 'number' || name === undefined) continue
    if (!allowed.has(name) || !isMemoryPage(path)) continue
    out.push({ project: name, path, rank })
    if (typeof title === 'string') titles.set(path.split('/').pop() ?? path, title)
  }
  return out
}

// The folder of one wiki project on disk, found by the `project:` line of each folder's _meta.md; null
// without `wikiDir` or when the project is not there.
async function wikiProject($: Api, project: string): Promise<string | null> {
  const known = projectDirs.get(project)
  if (known !== undefined) return known
  const wiki = option('wikiDir')
  if (wiki === null) return null
  const root = expandHome(wiki, await home($)).replace(/[\\/]+$/, '')
  try {
    for (const ws of await $.fs.list(root)) {
      if (ws.kind !== 'dir') continue
      for (const p of await $.fs.list(`${root}/${ws.name}`)) {
        if (p.kind !== 'dir') continue
        const dir = `${root}/${ws.name}/${p.name}`
        const meta = await $.fs.read(`${dir}/_meta.md`).catch(() => '')
        const name = /^project:\s*(.+?)\s*$/m.exec(meta.replace(/\r\n?/g, '\n'))?.[1]?.replace(/^["']|["']$/g, '')
        if (name !== undefined && !projectDirs.has(name)) projectDirs.set(name, dir)
      }
    }
  } catch {
    // an unreadable wiki: the page comes through memory_read_page
  }
  if (!projectDirs.has(project)) projectDirs.set(project, null)
  return projectDirs.get(project) ?? null
}

// A page body: from the wiki on disk when it is there, through memory_read_page otherwise.
async function pageText($: Api, route: Route, project: string, path: string): Promise<string | null> {
  const dir = await wikiProject($, project)
  const raw = dir === null ? null : await $.fs.read(`${dir}/${path}`).catch(() => null)
  if (raw !== null) return pageBody(raw)
  const body = field(await memoryTool($, route, 'memory_read_page', { path, workspace: WORKSPACE, project, max_chars: 64000 }), 'body')
  return typeof body === 'string' ? body : null
}

// The wiki projects of this session, most specific first: the `.ai-memory.toml` nearest above the
// session folder, then the projects file entries whose folder holds it. At most 3; _global is added to
// every search.
async function projectsOf($: Api): Promise<string[]> {
  if (sessionProjects !== null) return sessionProjects
  const out: string[] = []
  const h = await home($)
  let dir = cwd.replace(/[\\/]+$/, '')
  for (let i = 0; i < 12 && dir !== ''; i += 1) {
    const raw = await $.fs.read(`${dir}/.ai-memory.toml`).catch(() => null)
    const named = raw === null ? null : tomlProject(raw)
    if (named !== null) {
      out.push(named)
      break
    }
    const up = dir.replace(/[\\/][^\\/]*$/, '')
    if (up === dir) break
    dir = up
  }
  const file = option('projectsFile')
  const listed = file === null ? null : await $.fs.read(expandHome(file, h)).catch(() => null)
  if (listed !== null) out.push(...projectsAt(listed, cwd, h))
  sessionProjects = [...new Set(out)].filter((p) => p !== GLOBAL).slice(0, 3)
  return sessionProjects
}

function maxTokens(): number {
  const v = Number(values.recallMaxTokens)
  return Number.isFinite(v) && v > 0 ? v : RECALL_DEFAULTS.maxTokens
}

type Outcome = { kind: 'injected'; block: string; paths: string[]; summarized: string[]; tokens: number; route: string } | { kind: 'skipped'; reason: string }

// The searches on one route; null when every search on it failed.
async function search($: Api, route: Route, query: string, scopes: readonly string[]): Promise<{ all: unknown; scoped: unknown[] } | null> {
  const [all, ...scoped] = await Promise.all([
    memoryTool($, route, 'memory_query', { query, global: true, limit: 30 }),
    ...scopes.map((project) => memoryTool($, route, 'memory_query', { query, workspace: WORKSPACE, project, limit: 15 })),
  ])
  return all === null && scoped.every((x) => x === null) ? null : { all, scoped }
}

// The recall block for one prompt, or why there is none.
async function recall($: Api, prompt: string): Promise<Outcome> {
  const skip = skipReason(prompt)
  if (skip !== null) return { kind: 'skipped', reason: `recall-skipped-${skip}` }
  const words = keywords(prompt)
  const query = words.join(' ')
  const projects = await projectsOf($)
  const allowed = new Set([...projects, GLOBAL])
  // The project search runs in each session project, or in _global when there is none. A name that is
  // not a wiki project answers an error and counts as no hits.
  const scopes = projects.length > 0 ? projects : [GLOBAL]
  let found: { route: Route; all: unknown; scoped: unknown[] } | null = null
  for (const route of await routes($)) {
    const r = await search($, route, query, scopes)
    if (r !== null) {
      found = { route, ...r }
      break
    }
  }
  if (found === null) return { kind: 'skipped', reason: 'recall-failed' }
  const { route, all, scoped } = found
  const titles = new Map<string, string>()
  const ranked = rankPages({
    words,
    text: hitsOf(all, 'global_hits', allowed, titles),
    fused: scoped.flatMap((answer, i) => [...hitsOf(answer, 'hits', allowed, titles, scopes[i]), ...hitsOf(answer, 'global_scope_hits', allowed, titles, GLOBAL)]),
    titles,
    max: RECALL_DEFAULTS.pages,
  }).filter((h) => !injected.has(`${h.project}\n${h.path}`))
  const bodies = await Promise.all(ranked.map((h) => pageText($, route, h.project, h.path)))
  const pages: Page[] = []
  ranked.forEach((h, i) => {
    const body = bodies[i]
    if (typeof body === 'string') pages.push({ project: h.project, path: h.path, body })
  })
  const r = recallContext(pages, maxTokens())
  if (r === null) return { kind: 'skipped', reason: 'recall-none' }
  for (const p of pages) if (r.paths.includes(p.path)) injected.add(`${p.project}\n${p.path}`)
  return { kind: 'injected', block: r.text, paths: r.paths, summarized: r.summarized, tokens: r.tokens, route: route.prefix === '' ? 'ai-memory' : 'gateway' }
}

export function register(on: On, options: PluginOptions) {
  values = options
  injected.clear()
  projectDirs.clear()
  sessionProjects = null
  // Off, the mod registers no hook.
  if (values.enabled === false) return

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    sessionProjects = null
    // One file per session, because `$.fs.write` rewrites the whole file and two sessions sharing one
    // would erase each other's lines. HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const h = await home($)
    if (h !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${h}/.local/state/mods/recall/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  // Only a prompt from a person or the host app searches; a scheduled or agent message does not.
  on('prompt.submit', async ($, e, next) => {
    if (!REQUEST_ORIGINS.has(e.origin.kind)) return next(e)
    const began = await $.clock.now()
    const r = await recall($, e.text).catch((): Outcome => ({ kind: 'skipped', reason: 'recall-failed' }))
    const ms = (await $.clock.now()) - began
    if (r.kind === 'skipped') {
      countAction(tally, r.reason)
      await log($, { event: r.reason, ms }).catch(() => undefined)
      return next(e)
    }
    countAction(tally, 'recall-injected')
    await log($, { event: 'recall-injected', source: r.route, pages: r.paths, summarized: r.summarized, tokens: r.tokens, ms }).catch(() => undefined)
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
