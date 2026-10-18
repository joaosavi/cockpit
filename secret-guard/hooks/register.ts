// Keeps the value of a secret out of every tool result, built-in tools, MCP tools and subagents alike.
//
// Ported from an earlier Perl hook. Nothing is refused: the value becomes `<hidden:NAME>` before it reaches
// the transcript, and the agent keeps reading, editing and using `.env` files. When the agent writes a
// placeholder back in an edit of a secret file, the real value goes to the file in its place.
//
// The list of values lives only in this module's memory, never on disk, and the diary records only
// event names and secret names, never a value or a tool's output. At the end of each session, one
// summary line counts the tool calls the mod saw, the results it redacted, the inputs it restored, and
// the time its tool.call hook spent outside `next`, which is where the stat of every source goes.

import type { Hook, On, PluginOptions, ToolCallInput, ToolCallResult } from 'claude-code'
import {
  buildTable,
  DEFAULTS,
  type EnvFile,
  expandHome,
  fillCommand,
  findArgs,
  filledNotice,
  type Found,
  isEnvFileName,
  parseFind,
  isEnvPath,
  isExample,
  isSecretsDirEntry,
  DIRS_CHECK_MS,
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
  secretsDirOf,
  SKIPPED_DIRS,
  sortedNames,
  type Table,
  total,
  unfilledText,
  valuesForFile,
  WATCHED_FROM_DEPTH,
} from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

type Paths = { secretsFile: string; envRoot: string }

// What the last folder scan found: the `.env*` files, and the folders where a new one would appear.
type Scan = { envFiles: string[]; dirs: string[]; at: number }

type Built = {
  table: Table
  builtAt: number
  // The source files the list was read from, and whether each existed then: the secrets file, its folder
  // and the files in it, and every `.env*` the scan found. Their mtimes are checked on every call; the
  // folder's moves when a file in it is created, removed or renamed.
  files: ReadonlyMap<string, boolean>
  scan: Scan
  // When the folders' mtimes were last checked.
  dirsCheckedAt: number
}

// How the folders are looked at on this call: not at all unless 60 s passed, their mtimes checked, or
// scanned again without asking.
type Rescan = 'due' | 'check' | 'force'

let o: Options = DEFAULTS
let diary = ''
let cwd = ''
let tally = newTally()
let built: Built | null = null
// Parallel tool calls share one rebuild.
let building: Promise<Built> | null = null

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

async function paths($: Api): Promise<Paths> {
  // HOME, or USERPROFILE on Windows, where HOME is usually unset.
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
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

// The files of the secrets folder, and whether the folder exists. A missing folder is not listed.
async function secretsDirFiles($: Api, dir: string): Promise<{ exists: boolean; files: EnvFile[] }> {
  let kind
  try {
    kind = (await $.fs.stat(dir)).kind
  } catch {
    return { exists: false, files: [] }
  }
  if (kind !== 'dir') return { exists: false, files: [] }
  const files: EnvFile[] = []
  for (const entry of await $.fs.list(dir)) {
    const path = `${dir}/${entry.name}`
    if (!isSecretsDirEntry(entry.name) || !(entry.kind === 'file' || (entry.isLink && (await isFile($, path))))) continue
    const text = await readOrNull($, path)
    if (text !== null) files.push({ path, text })
  }
  return { exists: true, files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) }
}

// The `.env*` files under `dir`, and the folders whose mtime is watched, as the Perl hook's folder scan found them.
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

// The same scan in one `find` process. False when `find` is missing or fails, and the walk above runs.
async function scanWithFind($: Api, root: string, files: string[], watched: string[]): Promise<boolean> {
  let r
  try {
    r = await $.process.run(findArgs(root), { timeoutMs: 30_000 })
  } catch {
    return false
  }
  if (r.exitCode !== 0 || r.isStdoutTruncated) return false
  const f = parseFind(r.stdout)
  files.push(...f.files)
  for (const link of f.links) if (await isFile($, link)) files.push(link)
  watched.push(...f.dirs)
  return true
}

// The process's environment as `/proc/self/environ` spells it: NUL-separated `NAME=value`. Linux has
// the file. Elsewhere a child started by `$.process.run` inherits the same environment and prints it:
// `env -0`, then `env`, then Windows' `cmd /c set`, the last two one entry per line. Empty when none runs.
async function environText($: Api): Promise<string> {
  const proc = await readOrNull($, '/proc/self/environ')
  if (proc !== null) return proc
  const attempts: ReadonlyArray<readonly [readonly string[], boolean]> = [
    [['env', '-0'], false],
    [['env'], true],
    [['cmd', '/d', '/c', 'set'], true],
  ]
  for (const [argv, byLine] of attempts) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 5_000 })
      if (r.exitCode === 0 && !r.isStdoutTruncated && r.stdout !== '') return byLine ? r.stdout.replace(/\r?\n/g, '\0') : r.stdout
    } catch {
      // not on this system: the next one
    }
  }
  return ''
}

// Reads every source again. The folders are scanned only when `prior` is null.
async function build($: Api, prior: Scan | null): Promise<Built> {
  const builtAt = await $.clock.now()
  const p = await paths($)
  let s = prior
  if (s === null) {
    const found: string[] = []
    const dirs: string[] = []
    // An empty env root turns the folder scan off: the list then holds the secrets file, the
    // environment and URL passwords, and the known token formats still apply.
    if (p.envRoot !== '' && !(await scanWithFind($, p.envRoot, found, dirs))) await scan($, p.envRoot, SCAN_DEPTH, found, dirs)
    s = { envFiles: found.sort(), dirs, at: builtAt }
  }
  const files = s.envFiles
  const secrets = await readOrNull($, p.secretsFile)
  const secretsDir = secretsDirOf(p.secretsFile)
  const fromDir = await secretsDirFiles($, secretsDir)
  const envFiles: EnvFile[] = []
  for (const path of files) {
    const text = await readOrNull($, path)
    if (text !== null) envFiles.push({ path, text })
  }
  // `$.env.get` takes only literal names, so the names come from the process's own environment.
  const environ = parseEnviron(await environText($))
  const table = buildTable({ secrets, secretsDirFiles: fromDir.files, envFiles, environ, minLength: o.minLength })
  const known = new Map<string, boolean>([
    [p.secretsFile, secrets !== null],
    [secretsDir, fromDir.exists],
    ...[...fromDir.files, ...envFiles].map((f): [string, boolean] => [f.path, true]),
  ])
  await log($, {
    event: 'list-built',
    scanned: prior === null,
    values: table.nameOf.size,
    secretsDirFiles: fromDir.files.length,
    envFiles: envFiles.filter((f) => !isExample(f.path)).length,
    exampleFiles: envFiles.filter((f) => isExample(f.path)).length,
    environment: environ.length,
    ms: (await $.clock.now()) - builtAt,
  })
  return { table, builtAt, files: known, scan: s, dirsCheckedAt: builtAt }
}

// A source changed when it appeared, disappeared, or has an mtime from the build's millisecond on: `>=`,
// so a change in the same millisecond the list was built also rebuilds it.
async function filesChanged($: Api, b: Built): Promise<boolean> {
  const checks = await Promise.all(
    [...b.files].map(async ([path, existed]) => {
      try {
        const mtime = (await $.fs.stat(path)).mtimeMs
        return !existed || mtime >= b.builtAt
      } catch {
        return existed
      }
    }),
  )
  return checks.some((changed) => changed)
}

// A folder's mtime moves when a file is created, removed or renamed in it, so a new `.env` there shows.
async function dirsChanged($: Api, b: Built): Promise<boolean> {
  const checks = await Promise.all(
    b.scan.dirs.map(async (path) => {
      try {
        return (await $.fs.stat(path)).mtimeMs >= b.scan.at
      } catch {
        return true
      }
    }),
  )
  return checks.some((changed) => changed)
}

// The source files are checked on every call, which is a handful of stats. The folders, which can be
// over a hundred under a root holding many repos, are checked at most every 60 s, or right away when
// the call touched a secret file. With no env root there are no folders to check.
async function isFresh($: Api, b: Built, rescan: Rescan): Promise<{ isFresh: boolean; prior: Scan | null }> {
  const now = await $.clock.now()
  if (now - b.builtAt >= MAX_AGE_MS || rescan === 'force') return { isFresh: false, prior: null }
  if (b.scan.dirs.length > 0 && (rescan === 'check' || now - b.dirsCheckedAt >= DIRS_CHECK_MS)) {
    b.dirsCheckedAt = now
    if (await dirsChanged($, b)) return { isFresh: false, prior: null }
  }
  return (await filesChanged($, b)) ? { isFresh: false, prior: b.scan } : { isFresh: true, prior: b.scan }
}

async function currentTable($: Api, rescan: Rescan = 'due'): Promise<Table> {
  let prior: Scan | null = null
  if (built !== null) {
    const f = await isFresh($, built, rescan)
    if (f.isFresh) return built.table
    prior = f.prior
  }
  if (building === null) {
    building = build($, prior).finally(() => {
      building = null
    })
  }
  built = await building
  return built.table
}

// Whether this call may have created or changed a secret file the folder check would miss for up to 60 s.
async function rescanFor($: Api, e: ToolCallInput): Promise<Rescan> {
  if (e.tool === 'Bash') return /\.env|\.secrets/.test(e.command) ? 'check' : 'due'
  const path = e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : e.tool === 'NotebookEdit' ? e.notebook_path : null
  if (path === null) return 'due'
  const { secretsFile } = await paths($)
  if (!isEnvPath(path) && path !== secretsFile) return 'due'
  return built?.files.has(path) === true ? 'check' : 'force'
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
      diary = `${home}/.local/state/mods/secret-guard/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    // Build the list in the background now, so the session's first tool call does not wait for it
    // (it took up to half a second on a machine with seven .env files). A call that comes first
    // joins the same build.
    $.clock.after(0, async () => {
      try {
        await currentTable($)
      } catch {
        // the first tool call builds it again and reports
      }
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) =>
    timed($, next, async (pass) => {
      const restored = await restoreInput($, e)
      if (restored !== null) {
        countAction(tally, 'restored')
        await log($, { event: 'restored', tool: e.tool, names: restored.names })
      }
      let input = restored?.input ?? e
      const notes: string[] = restored === null ? [] : [RESTORED_NOTICE]
      // A command that only mentions the placeholder text, such as a grep for `<hidden:[A-Z]*>`, names
      // nothing to fill and runs as written.
      const before = e.tool === 'Bash' && /<(?:hidden|oculto):/.test(e.command) ? await currentTable($) : null
      const f = e.tool === 'Bash' && before !== null ? fillCommand(e.command, before) : null
      if (before !== null && f !== null && f.filled.length + f.unfilled.length > 0) {
        if (f.unfilled.length > 0) {
          countAction(tally, 'unfilled')
          await log($, { event: 'unfilled', names: f.unfilled })
          return { deny: unfilledText(f.unfilled, before) }
        }
        countAction(tally, 'filled')
        await log($, { event: 'filled', names: f.filled })
        input = { ...e, command: f.command }
        notes.push(filledNotice(f.filled))
      }
      const r = await pass(input)
      // The list is read after the tool ran, so a value the tool itself just wrote to a `.env` is already in it.
      const t = await currentTable($, await rescanFor($, e))
      const found: Found = new Map()
      const out = redactResult(r, t, found, notes)
      if (found.size > 0) {
        countAction(tally, 'redacted')
        await log($, { event: 'redacted', tool: e.tool, agentId: e.agentId, names: sortedNames(found), count: total(found), isError: r.isError === true })
      }
      return out
    }),
  ).catch(async ($, e, next) => {
    // Fails closed: an output the mod could not check never reaches the model.
    countAction(tally, 'failed')
    try {
      await log($, { event: 'failed', tool: e.tool, kind: next.error.kind, afterTool: next.called })
    } catch {
      // the diary may be what failed
    }
    return {
      deny: next.called
        ? `secret-guard failed (${next.error.kind}) while hiding secrets, so the output was withheld. The call ran; check its effect before running it again.`
        : `secret-guard failed (${next.error.kind}) before the call, so it did not run. Try again.`,
    }
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
