// The pure part of the collision-guard mod: the options, the registry entry each session keeps, which
// paths an edit touches, which git commands would sweep in or discard another session's edits, and the
// texts the agent and the user read.

// --- options ---

// `confirm` refuses a risky git command once and lets the same command through when the agent runs it
// again within CONFIRM_MS; `note` lets it run and tells the agent afterwards; `off` skips git commands.
export type GitMode = 'confirm' | 'note' | 'off'

export type Options = {
  git: GitMode
  // How long another session's edit to a file outside any git repo counts, in minutes. Inside a repo,
  // an edit counts while git still shows the file as changed.
  windowMinutes: number
  // A session whose entry was not touched for this long is gone (it crashed or was killed), in hours.
  expireHours: number
}

export const DEFAULTS: Options = { git: 'confirm', windowMinutes: 30, expireHours: 24 }

export function options(values: Readonly<Record<string, unknown>>): Options {
  const git = values.git
  const window = Number(values.windowMinutes)
  const expire = Number(values.expireHours)
  return {
    git: git === 'note' || git === 'off' || git === 'confirm' ? git : DEFAULTS.git,
    windowMinutes: Number.isFinite(window) && window > 0 ? window : DEFAULTS.windowMinutes,
    expireHours: Number.isFinite(expire) && expire > 0 ? expire : DEFAULTS.expireHours,
  }
}

// How long a refused git command stays confirmed: the agent runs it again within this, and it runs.
export const CONFIRM_MS = 2 * 60_000

// --- the registry ---

// One file per session under the registry folder, written only by its own session, so two sessions
// never write the same file. `root` is the edited file's git work tree, or null outside any repo.
export type Edit = { at: number; root: string | null }

export type Entry = {
  session: string
  cwd: string
  startedAt: number
  seenAt: number
  ended: boolean
  edits: Record<string, Edit>
}

export function registryDir(home: string): string {
  return `${home}/.local/state/mods/collision-guard/sessions`
}

export function entryPath(home: string, session: string): string {
  return `${registryDir(home)}/${session}.json`
}

export function newEntry(session: string, cwd: string, now: number): Entry {
  return { session, cwd, startedAt: now, seenAt: now, ended: false, edits: {} }
}

// An entry read from disk, or null when the text is not one. A half-written file reads as null.
export function parseEntry(text: string): Entry | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const e = v as Partial<Entry>
  if (typeof e.session !== 'string' || typeof e.cwd !== 'string' || typeof e.seenAt !== 'number') return null
  const edits: Record<string, Edit> = {}
  if (typeof e.edits === 'object' && e.edits !== null) {
    for (const [path, edit] of Object.entries(e.edits)) {
      if (typeof edit?.at === 'number') edits[path] = { at: edit.at, root: typeof edit.root === 'string' ? edit.root : null }
    }
  }
  return { session: e.session, cwd: e.cwd, startedAt: typeof e.startedAt === 'number' ? e.startedAt : e.seenAt, seenAt: e.seenAt, ended: e.ended === true, edits }
}

// The other sessions that still count: not this one, not ended, and touched within expireHours.
export function liveOthers(entries: readonly Entry[], self: string, now: number, o: Options): Entry[] {
  const expire = o.expireHours * 3_600_000
  return entries.filter((e) => e.session !== self && !e.ended && now - e.seenAt < expire)
}

// An entry is stale when its session ended or went quiet past expireHours; its file can go.
export function isStale(e: Entry, now: number, o: Options): boolean {
  return now - e.seenAt >= o.expireHours * 3_600_000 || (e.ended && now - e.seenAt >= 3_600_000)
}

// --- what an edit touches ---

const EDIT_TOOLS: Readonly<Record<string, string>> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

// The file an edit tool writes, or null for any other tool.
export function editedPath(tool: string, input: Readonly<Record<string, unknown>>): string | null {
  const key = EDIT_TOOLS[tool]
  if (key === undefined) return null
  const path = input[key]
  return typeof path === 'string' && isAbsolute(slashed(path)) ? slashed(path) : null
}

// A Windows path with forward slashes (`C:\\w\\a.ts` as `C:/w/a.ts`), the way git prints it, so one
// spelling keys the registry on every system. A POSIX path comes back as it is.
export function slashed(path: string): string {
  return path.replaceAll('\\', '/')
}

// `/...`, or a Windows drive path `C:/...`, after `slashed`.
function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

export function dirOf(path: string): string {
  const top = /^[A-Za-z]:\//.test(path) ? 3 : 1
  const i = path.lastIndexOf('/')
  return i < top ? path.slice(0, top) : path.slice(0, i)
}

// --- who else edited a path ---

// One other session's edit that may collide with this one.
export type Hit = { path: string; session: string; cwd: string; at: number; root: string | null }

// The other sessions' edits to `path`. Inside a repo, the caller keeps only the ones git still shows
// as changed; outside, only the ones within windowMinutes count.
export function hitsForPath(path: string, others: readonly Entry[], now: number, o: Options): Hit[] {
  const hits: Hit[] = []
  for (const e of others) {
    const edit = e.edits[path]
    if (edit === undefined) continue
    if (edit.root === null && now - edit.at > o.windowMinutes * 60_000) continue
    hits.push({ path, session: e.session, cwd: e.cwd, at: edit.at, root: edit.root })
  }
  return hits
}

// The other sessions' edits inside the work tree `root`, newest first.
export function hitsInRepo(root: string, others: readonly Entry[]): Hit[] {
  const hits: Hit[] = []
  for (const e of others) {
    for (const [path, edit] of Object.entries(e.edits)) {
      if (edit.root === root) hits.push({ path, session: e.session, cwd: e.cwd, at: edit.at, root })
    }
  }
  return hits.sort((a, b) => b.at - a.at)
}

// The paths `git status --porcelain -z` lists as changed, relative to the work tree. A rename lists the
// new path, then the old one as its own field.
export function parseStatus(out: string): Set<string> {
  const changed = new Set<string>()
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] ?? ''
    if (f.length < 4) continue
    changed.add(f.slice(3))
    if (f[0] === 'R' || f[0] === 'C') {
      const old = fields[i + 1]
      if (old !== undefined && old !== '') changed.add(old)
      i++
    }
  }
  return changed
}

// Whether git lists `path` as changed. The match is by suffix, so a path reached through a symbolic
// link to the work tree still matches what git prints relative to the real one.
export function isChanged(path: string, changed: ReadonlySet<string>): boolean {
  for (const rel of changed) if (path.endsWith(`/${rel}`)) return true
  return false
}

// --- git commands ---

// What a git command would do to the other sessions' edits in its work tree.
export type GitOp = 'stage-all' | 'commit-all' | 'stash' | 'switch' | 'discard' | 'clean'

// `scope` holds the paths a command names, resolved, when it names any; null when it covers the whole work tree.
export type GitTarget = { dir: string; op: GitOp; text: string; scope: string[] | null }

// Splits a shell line on `&&`, `||`, `;`, `|` and newlines. Quotes are honored, so a separator inside
// a commit message does not split it.
function segments(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? ''
    if (quote !== null) {
      if (c === quote) quote = null
      cur += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
      continue
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (c === '&' && line[i + 1] !== '&') {
        cur += c
        continue
      }
      if ((c === '&' || c === '|') && line[i + 1] === c) i++
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur.trim())
  return out.filter((s) => s !== '')
}

// The words of one segment, quotes removed.
function words(segment: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(segment); m !== null; m = re.exec(segment)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

function resolve(dir: string, path: string, home: string): string {
  const p = slashed(path === '~' ? home : path.startsWith('~/') ? `${home}${path.slice(1)}` : path)
  const joined = isAbsolute(p) ? p : `${slashed(dir)}/${p}`
  // A Windows drive stays in front, as the root `..` cannot climb past.
  const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? ''
  const parts: string[] = []
  for (const part of joined.slice(drive.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${drive}/${parts.join('/')}`
}

const has = (args: readonly string[], ...flags: string[]) => args.some((a) => flags.includes(a))
// A short flag cluster that holds the letter, like `-am` for `-a`.
const hasShort = (args: readonly string[], letter: string) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter))

function classify(sub: string, args: readonly string[]): GitOp | null {
  const paths = args.filter((a) => !a.startsWith('-'))
  switch (sub) {
    case 'add':
      return has(args, '-A', '--all', '-u', '--update') || paths.some((p) => p === '.' || p === ':/' || p === '*') ? 'stage-all' : null
    case 'commit':
      return has(args, '--all') || hasShort(args, 'a') ? 'commit-all' : null
    case 'stash': {
      const verb = paths[0]
      return verb === undefined || verb === 'push' || verb === 'save' ? 'stash' : null
    }
    case 'checkout':
      if (args.includes('--') || paths.includes('.') || has(args, '-f', '--force')) return 'discard'
      return paths.length > 0 || has(args, '-b', '-B') ? 'switch' : null
    case 'switch':
      return has(args, '--discard-changes', '-f', '--force') ? 'discard' : 'switch'
    case 'restore':
      return has(args, '--staged', '-S') && !has(args, '--worktree', '-W') ? null : 'discard'
    case 'reset':
      return has(args, '--hard', '--merge', '--keep') ? 'discard' : null
    case 'clean':
      return has(args, '-f', '--force') || hasShort(args, 'f') ? 'clean' : null
    default:
      return null
  }
}

// Options that take the next word as their value, so the value is not read as a path.
const VALUED = new Set(['-m', '--message', '-F', '--file', '-s', '--source', '-C', '-c', '--pathspec-from-file', '-e', '--exclude'])

// The paths a command names, resolved from the folder it runs in. A command that names none, names the
// whole tree (`:/`) or uses a wildcard or a magic pathspec covers everything, and gets null. A checkout
// names paths only after `--`, since before it a word is a branch.
function scopeOf(sub: string, args: readonly string[], at: string, home: string): string[] | null {
  if (!['add', 'stash', 'checkout', 'restore', 'clean'].includes(sub)) return null
  const dash = args.indexOf('--')
  let words: string[] = []
  if (dash >= 0) words = args.slice(dash + 1)
  else if (sub !== 'checkout') {
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? ''
      if (VALUED.has(a)) i++
      else if (!a.startsWith('-')) words.push(a)
    }
    if (sub === 'stash') words = words.slice(1)
  }
  if (words.length === 0 || words.some((w) => w.startsWith(':') || /[*?[]/.test(w))) return null
  return words.map((w) => resolve(at, w, home).replace(/\/+$/, ''))
}

// Whether `path` is one of the paths a command named, or lies under one of them.
export function inScope(path: string, scope: readonly string[] | null): boolean {
  return scope === null || scope.some((s) => path === s || path.startsWith(`${s}/`))
}

// The git commands in a shell line that would touch other sessions' edits, each with the folder it
// runs in: `cd` earlier in the line and `git -C <dir>` are followed.
export function gitTargets(line: string, cwd: string, home: string): GitTarget[] {
  const out: GitTarget[] = []
  let dir = cwd
  for (const seg of segments(line)) {
    const w = words(seg)
    let i = 0
    while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i] ?? '')) i++
    const cmd = w[i]
    if (cmd === 'cd') {
      dir = resolve(dir, w[i + 1] ?? home, home)
      continue
    }
    if (cmd !== 'git') continue
    let at = dir
    i++
    // Global options before the subcommand; `-C` moves the folder.
    while (i < w.length && (w[i] ?? '').startsWith('-')) {
      const opt = w[i] ?? ''
      if (opt === '-C') {
        at = resolve(at, w[i + 1] ?? '.', home)
        i += 2
      } else if (opt === '-c' || opt === '--git-dir' || opt === '--work-tree') {
        i += 2
      } else {
        i++
      }
    }
    const sub = w[i]
    if (sub === undefined) continue
    const op = classify(sub, w.slice(i + 1))
    if (op !== null) out.push({ dir: at, op, text: seg, scope: scopeOf(sub, w.slice(i + 1), at, home) })
  }
  return out
}

// --- the texts ---

export function ago(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return `${h} h ago`
}

function tilde(path: string, home: string): string {
  return home !== '' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

function who(h: Hit, home: string): string {
  return `session ${h.session.slice(0, 8)} in ${tilde(h.cwd, home)}`
}

// What the agent reads after an edit to a file another session also edited.
export function editNote(path: string, hits: readonly Hit[], now: number, home: string): string {
  const lines = hits.map((h) => `- ${who(h, home)}, edited ${ago(now - h.at)}`)
  return [
    `collision-guard: another Claude Code session also edited ${tilde(path, home)}, and its change is not committed:`,
    ...lines,
    'Read the file again before building on your version of it, and tell the user both sessions are working on it.',
  ].join('\n')
}

// The one line the user sees for the same collision.
export function editToast(path: string, hits: readonly Hit[], now: number, home: string): string {
  const h = hits[0]
  if (h === undefined) return ''
  const more = hits.length > 1 ? ` and ${hits.length - 1} more` : ''
  return `collision-guard: ${tilde(path, home)} was also edited by ${who(h, home)}${more}, ${ago(now - h.at)}`
}

const EFFECT: Readonly<Record<GitOp, string>> = {
  'stage-all': 'would stage them along with your own',
  'commit-all': 'would commit them along with your own',
  stash: 'would stash them away from that session',
  switch: 'would change the files under that session, to another branch or an older version',
  discard: 'may discard them',
  clean: 'may delete them, when they are new files',
}

const MAX_LISTED = 8

// What the agent reads when a git command would touch other sessions' uncommitted edits.
export function gitNote(t: GitTarget, hits: readonly Hit[], now: number, home: string, mode: GitMode): string {
  const listed = hits.slice(0, MAX_LISTED).map((h) => `- ${tilde(h.path, home)} (${who(h, home)}, edited ${ago(now - h.at)})`)
  const more = hits.length > MAX_LISTED ? [`- and ${hits.length - MAX_LISTED} more`] : []
  const head = `collision-guard: another Claude Code session has uncommitted edits in this repo, and \`${t.text}\` ${EFFECT[t.op]}:`
  const tail =
    mode === 'confirm'
      ? 'Nothing ran. Name your own files instead, or run the same command again within 2 minutes if those edits belong in it.'
      : 'The command ran. Check that it did not take those edits along, and tell the user.'
  return [head, ...listed, ...more, tail].join('\n')
}

export function gitToast(t: GitTarget, hits: readonly Hit[], mode: GitMode): string {
  const verb = mode === 'confirm' ? 'held' : 'ran over'
  const sessions = new Set(hits.map((h) => h.session)).size
  return `collision-guard: ${verb} \`${t.text}\`, ${hits.length} uncommitted file${hits.length === 1 ? '' : 's'} from ${sessions} other session${sessions === 1 ? '' : 's'}`
}
