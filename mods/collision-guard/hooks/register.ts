// Warns when two Claude Code sessions on the same machine work on the same files.
//
// Each session keeps one registry file with the files it edited. After an edit, the mod reads the other
// sessions' files: when another live session also edited that file and git still shows its change (or,
// outside a repo, it did so within `windowMinutes`), the agent reads a note and the user sees a toast.
// Before a git command that would stage, commit, stash, switch away from or discard another session's
// uncommitted edits, the mod holds the command once and lists those files (`git: confirm`), or lets it
// run and tells the agent afterwards (`git: note`). Running the same command again within 2 minutes
// lets it through. Claude Code's own Edit already refuses a file changed since it was read, so the
// mod adds the warning, not a lock.
//
// The diary records each warning by kind, never a file's content, and the session ends with one
// summary line: the calls seen, the warnings, and the hook's own time.

import type { Hook, On, PluginOptions, ToolCallResult } from 'claude-code'
import {
  CONFIRM_MS,
  DEFAULTS,
  dirOf,
  editedPath,
  editNote,
  editToast,
  type Entry,
  entryPath,
  gitNote,
  gitTargets,
  gitToast,
  type Hit,
  hitsForPath,
  hitsInRepo,
  isChanged,
  isStale,
  liveOthers,
  newEntry,
  type Options,
  options,
  parseEntry,
  parseStatus,
  registryDir,
} from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = DEFAULTS
let home = ''
let diary = ''
let cwd = ''
let tally = newTally()
let entry: Entry | null = null
// The work tree of each folder an edit touched, or null outside any repo.
const roots = new Map<string, string | null>()
// Collisions already reported: `path|session|at`, so one edit of the other session warns once.
const warned = new Set<string>()
// Git commands held once, by `dir|command`, with when.
const held = new Map<string, number>()
// Writes of this session's entry run one after another.
let writing: Promise<void> = Promise.resolve()

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

// This session's entry, created on first use, for the session id current now (`/clear` changes it).
async function own($: Api): Promise<Entry> {
  const id = await $.session.id()
  if (entry === null || entry.session !== id) entry = newEntry(id, cwd, await $.clock.now())
  return entry
}

function save($: Api, e: Entry): Promise<void> {
  const text = JSON.stringify(e)
  const path = entryPath(home, e.session)
  writing = writing.then(() => $.fs.write(path, text)).catch(() => {})
  return writing
}

// Every session's entry on disk; unreadable and half-written files are skipped.
async function entries($: Api): Promise<Entry[]> {
  let names
  try {
    names = await $.fs.list(registryDir(home))
  } catch {
    return []
  }
  const out: Entry[] = []
  await Promise.all(
    names
      .filter((n) => n.kind === 'file' && n.name.endsWith('.json'))
      .map(async (n) => {
        try {
          const e = parseEntry(await $.fs.read(`${registryDir(home)}/${n.name}`))
          if (e !== null) out.push(e)
        } catch {
          // a file removed while listing
        }
      }),
  )
  return out
}

async function git($: Api, argv: readonly string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...argv], { timeoutMs: 5_000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

async function rootOf($: Api, dir: string): Promise<string | null> {
  const known = roots.get(dir)
  if (known !== undefined) return known
  const out = await git($, ['-C', dir, 'rev-parse', '--show-toplevel'])
  const root = out === null || out.trim() === '' ? null : out.trim()
  roots.set(dir, root)
  return root
}

// The hits git still shows as changed. Outside a repo, hits pass as they are.
async function stillChanged($: Api, hits: readonly Hit[]): Promise<Hit[]> {
  const byRoot = new Map<string, Hit[]>()
  const out: Hit[] = []
  for (const h of hits) {
    if (h.root === null) out.push(h)
    else byRoot.set(h.root, [...(byRoot.get(h.root) ?? []), h])
  }
  for (const [root, list] of byRoot) {
    const status = await git($, ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...new Set(list.map((h) => h.path))])
    if (status === null) continue
    const changed = parseStatus(status)
    out.push(...list.filter((h) => isChanged(h.path, changed)))
  }
  return out
}

function withContext(r: ToolCallResult, note: string): ToolCallResult {
  if (r.deny !== undefined) return r
  return { ...r, context: [...(r.context ?? []), note] }
}

async function afterEdit($: Api, path: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  const now = await $.clock.now()
  const root = await rootOf($, dirOf(path))
  const mine = await own($)
  mine.edits[path] = { at: now, root }
  mine.seenAt = now
  await save($, mine)
  const others = liveOthers(await entries($), mine.session, now, o)
  const fresh = hitsForPath(path, others, now, o).filter((h) => !warned.has(`${h.path}|${h.session}|${h.at}`))
  if (fresh.length === 0) return r
  const hits = await stillChanged($, fresh)
  if (hits.length === 0) return r
  for (const h of hits) warned.add(`${h.path}|${h.session}|${h.at}`)
  countAction(tally, 'edit-warned')
  await log($, { event: 'edit-warned', sessions: hits.map((h) => h.session.slice(0, 8)) })
  $.ui.toast(editToast(path, hits, now, home), { timeoutMs: 8_000 })
  return withContext(r, editNote(path, hits, now, home))
}

async function guardGit($: Api, command: string, pass: () => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const targets = gitTargets(command, await $.session.cwd(), home)
  if (targets.length === 0) return pass()
  const now = await $.clock.now()
  const mine = await own($)
  const others = liveOthers(await entries($), mine.session, now, o)
  if (others.length === 0) return pass()
  for (const t of targets) {
    const root = await rootOf($, t.dir)
    if (root === null) continue
    const hits = await stillChanged($, hitsInRepo(root, others))
    if (hits.length === 0) continue
    if (o.git === 'confirm') {
      const key = `${t.dir}|${command}`
      const at = held.get(key)
      if (at !== undefined && now - at < CONFIRM_MS) {
        held.delete(key)
        countAction(tally, 'git-confirmed')
        await log($, { event: 'git-confirmed', op: t.op, files: hits.length })
        return pass()
      }
      held.set(key, now)
      countAction(tally, 'git-held')
      await log($, { event: 'git-held', op: t.op, files: hits.length })
      $.ui.toast(gitToast(t, hits, 'confirm'), { timeoutMs: 8_000 })
      return { deny: gitNote(t, hits, now, home, 'confirm') }
    }
    countAction(tally, 'git-noted')
    await log($, { event: 'git-noted', op: t.op, files: hits.length })
    $.ui.toast(gitToast(t, hits, 'note'), { timeoutMs: 8_000 })
    return withContext(await pass(), gitNote(t, hits, now, home, 'note'))
  }
  return pass()
}

// Removes the entries of sessions that ended or went quiet, so the folder does not grow.
async function prune($: Api): Promise<void> {
  const now = await $.clock.now()
  const stale = (await entries($)).filter((e) => isStale(e, now, o))
  if (stale.length === 0) return
  try {
    await $.process.run(['rm', '-f', ...stale.map((e) => entryPath(home, e.session))], { timeoutMs: 5_000 })
  } catch {
    // the next session start tries again
  }
}

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    home = (await $.env.get('HOME')) ?? ''
    if (home !== '') {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/collision-guard/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
      $.clock.after(0, () => prune($))
    }
    return next(e)
  })

  // A quiet session still holds uncommitted edits, so each turn refreshes its entry's `seenAt`.
  on('turn.start', async ($, e, next) => {
    if (home !== '' && entry !== null) {
      entry.seenAt = await $.clock.now()
      await save($, entry)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) =>
    timed($, next, async (pass) => {
      if (home === '') return pass(e)
      const input = e as unknown as Readonly<Record<string, unknown>>
      const path = editedPath(e.tool, input)
      if (path !== null) return afterEdit($, path, await pass(e))
      const command = input.command
      if (e.tool === 'Bash' && o.git !== 'off' && typeof command === 'string') return guardGit($, command, () => pass(e))
      return pass(e)
    }),
  )

  on('session.end', async ($, e, next) => {
    const t = tally
    tally = newTally()
    try {
      if (entry !== null) {
        entry.ended = true
        entry.seenAt = await $.clock.now()
        await save($, entry)
        entry = null
      }
      await log($, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
