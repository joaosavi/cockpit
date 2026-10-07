// Keeps the value of a secret out of every tool result, built-in tools, MCP tools and subagents alike.
//
// Ported from hooks/segredo.pl. Nothing is refused: the value becomes `<hidden:NAME>` before it reaches
// the transcript, and the agent keeps reading, editing and using `.env` files. When the agent writes a
// placeholder back in an edit of a secret file, the real value goes to the file in its place.
//
// The list of values lives only in this module's memory, never on disk, and the diary records only
// event names and secret names, never a value or a tool's output.

import type { Hook, On, PluginOptions, ToolCallInput, ToolCallResult } from 'claude-code'
import {
  buildTable,
  DEFAULTS,
  type EnvFile,
  expandHome,
  type Found,
  isEnvFileName,
  isEnvPath,
  isExample,
  MAX_AGE_MS,
  type Options,
  options,
  parseEnviron,
  redactDeep,
  redactedNotice,
  redactText,
  RESTORED_NOTICE,
  restoreText,
  SCAN_DEPTH,
  SKIPPED_DIRS,
  sortedNames,
  type Table,
  total,
  valuesForFile,
  WATCHED_FROM_DEPTH,
} from './rules.ts'

type Api = Parameters<Hook<'session.start'>>[0]

type Paths = { secretsFile: string; envRoot: string }

type Built = {
  table: Table
  builtAt: number
  // Every file and folder whose change makes the list stale: the secrets file, the `.env*` files, and
  // the folders where a new `.env` would appear.
  sources: string[]
}

let o: Options = DEFAULTS
let diary = ''
let built: Built | null = null
// Parallel tool calls share one rebuild.
let building: Promise<Built> | null = null

async function log($: Api, entry: Record<string, unknown>) {
  if (diary === '') return
  let before = ''
  try {
    before = await $.fs.read(diary)
  } catch {
    // first entry of the session
  }
  const line = JSON.stringify({ at: new Date(await $.clock.now()).toISOString(), ...entry })
  await $.fs.write(diary, before + line + '\n')
}

async function paths($: Api): Promise<Paths> {
  const home = await $.env.get('HOME')
  return { secretsFile: expandHome(o.secretsFile, home), envRoot: expandHome(o.envRoot, home) }
}

async function readOrNull($: Api, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function isFile($: Api, path: string): Promise<boolean> {
  try {
    return (await $.fs.stat(path)).kind === 'file'
  } catch {
    return false
  }
}

// The `.env*` files under `dir`, and the folders whose mtime is watched, as segredo.pl's `varre`.
async function scan($: Api, dir: string, depth: number, files: string[], watched: string[]) {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return
  }
  if (depth >= WATCHED_FROM_DEPTH) watched.push(dir)
  const nested: Promise<void>[] = []
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir') {
      if (depth > 0 && !SKIPPED_DIRS.has(entry.name)) nested.push(scan($, path, depth - 1, files, watched))
    } else if (isEnvFileName(entry.name)) {
      // A link to a file counts, as Perl's `-f` follows it.
      if (entry.kind === 'file' || (entry.isLink && (await isFile($, path)))) files.push(path)
    }
  }
  await Promise.all(nested)
}

async function build($: Api): Promise<Built> {
  const builtAt = await $.clock.now()
  const p = await paths($)
  const files: string[] = []
  const watched: string[] = []
  await scan($, p.envRoot, SCAN_DEPTH, files, watched)
  files.sort()
  const secrets = await readOrNull($, p.secretsFile)
  const envFiles: EnvFile[] = []
  for (const path of files) {
    const text = await readOrNull($, path)
    if (text !== null) envFiles.push({ path, text })
  }
  // `$.env.get` takes only literal names, so the names come from the process's own environment.
  const environ = parseEnviron((await readOrNull($, '/proc/self/environ')) ?? '')
  const table = buildTable({ secrets, envFiles, environ, minLength: o.minLength })
  const sources = [...(secrets === null ? [] : [p.secretsFile]), ...files, ...watched]
  await log($, {
    event: 'list-built',
    values: table.nameOf.size,
    envFiles: envFiles.filter((f) => !isExample(f.path)).length,
    exampleFiles: envFiles.filter((f) => isExample(f.path)).length,
    environment: environ.length,
  })
  return { table, builtAt, sources }
}

// The mtime is compared with `>=`, so a change in the same millisecond the list was built also rebuilds it.
async function isFresh($: Api, b: Built): Promise<boolean> {
  if ((await $.clock.now()) - b.builtAt >= MAX_AGE_MS) return false
  const checks = await Promise.all(
    b.sources.map(async (path) => {
      try {
        return (await $.fs.stat(path)).mtimeMs < b.builtAt
      } catch {
        return false
      }
    }),
  )
  return checks.every((ok) => ok)
}

async function currentTable($: Api): Promise<Table> {
  if (built !== null && (await isFresh($, built))) return built.table
  if (building === null) {
    building = build($).finally(() => {
      building = null
    })
  }
  built = await building
  return built.table
}

async function isSecretFile($: Api, path: string): Promise<{ isSecret: boolean; isSecretsFile: boolean }> {
  const { secretsFile } = await paths($)
  const real = async (p: string) => {
    try {
      return (await $.fs.stat(p, { resolve: true })).realPath ?? p
    } catch {
      return p
    }
  }
  const isSecretsFile = (await real(path)) === (await real(secretsFile))
  return { isSecret: isSecretsFile || isEnvPath(path), isSecretsFile }
}

// For an edit of a secret file, the input with each placeholder replaced by the real value, or null
// when nothing changed. Only the text fields change; the rest of the input goes as it came.
async function restoreInput($: Api, e: ToolCallInput): Promise<{ input: ToolCallInput; names: string[] } | null> {
  const path = e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : e.tool === 'NotebookEdit' ? e.notebook_path : null
  if (path === null) return null
  const fields = e.tool === 'Edit' ? [e.old_string, e.new_string] : e.tool === 'Write' ? [e.content] : e.tool === 'NotebookEdit' ? [e.new_source] : []
  if (!fields.some((f) => /<(?:hidden|oculto):/.test(f))) return null
  const kind = await isSecretFile($, path)
  if (!kind.isSecret) return null
  const valueOf = valuesForFile(await currentTable($), await readOrNull($, path), kind.isSecretsFile, o.minLength)
  const names = new Set<string>()
  const fix = (s: string) => restoreText(s, valueOf, names)
  let input: ToolCallInput
  if (e.tool === 'Edit') input = { ...e, old_string: fix(e.old_string), new_string: fix(e.new_string) }
  else if (e.tool === 'Write') input = { ...e, content: fix(e.content) }
  else if (e.tool === 'NotebookEdit') input = { ...e, new_source: fix(e.new_source) }
  else return null
  return names.size === 0 ? null : { input, names: [...names].sort() }
}

function errorText(r: { result: unknown; text?: string }): string {
  if (r.text !== undefined) return r.text
  if (typeof r.result === 'string') return r.result
  return r.result === undefined ? '' : JSON.stringify(r.result)
}

// The result with every secret hidden. A changed result never carries core's `ref`, so core records
// the redacted one. An error result cannot be rewritten as an error by a hook, so it goes back as a
// `deny`, which the model also reads as an error.
function redactResult(r: ToolCallResult, t: Table, found: Found, extra: readonly string[]): ToolCallResult {
  if (r.deny !== undefined) {
    const deny = redactText(r.deny, t, found)
    return found.size === 0 ? r : { deny: `${deny}\n\n${redactedNotice(sortedNames(found))}` }
  }
  const context = (r.context ?? []).map((c) => redactText(c, t, found))
  if (r.isError === true) {
    const text = redactText(errorText(r), t, found)
    if (found.size === 0) return extra.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...extra] }
    return { deny: `${text}\n\n${redactedNotice(sortedNames(found))}` }
  }
  const result = redactDeep(r.result, t, found)
  if (found.size === 0) return extra.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...extra] }
  return { result, context: [...context, ...extra, redactedNotice(sortedNames(found))] }
}

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    if (home !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/secret-guard/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const restored = await restoreInput($, e)
    if (restored !== null) await log($, { event: 'restored', tool: e.tool, names: restored.names })
    const r = await next(restored?.input ?? e)
    // The list is read after the tool ran, so a value the tool itself just wrote to a `.env` is already in it.
    const t = await currentTable($)
    const found: Found = new Map()
    const out = redactResult(r, t, found, restored === null ? [] : [RESTORED_NOTICE])
    if (found.size > 0) {
      await log($, { event: 'redacted', tool: e.tool, agent: e.agentId ?? null, names: sortedNames(found), count: total(found), isError: r.isError === true })
    }
    return out
  }).catch(async ($, e, next) => {
    // Fails closed: an output the mod could not check never reaches the model.
    try {
      await log($, { event: 'failed', tool: e.tool, kind: next.error.kind, afterTool: next.called })
    } catch {
      // the diary may be what failed
    }
    return {
      deny: next.called
        ? `The secret-guard mod failed (${next.error.kind}) while hiding secrets in this tool's output, so the output was withheld. The call did run. Check its effect before running it again.`
        : `The secret-guard mod failed (${next.error.kind}) before this call ran, so it did not run. Try again.`,
    }
  })
}
