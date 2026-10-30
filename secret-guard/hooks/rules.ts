// The rules of the secret-guard mod, without the mods API, so the tests can run them directly.
//
// Ported from an earlier Perl hook. The values come from the secrets file and the files in its `.d`
// folder, from the `.env*` files under the env root when one is set, from the environment variables with a secret-looking name, and from
// the password of every `scheme://user:password@` URL. A value is replaced by `<hidden:NAME>` in every tool result.

export type Options = {
  // Off, the mod registers no hook.
  enabled: boolean
  // Off, a Bash command that names a placeholder does not run, instead of running with the value.
  fillCommands: boolean
  // A KEY=value file whose every value is a secret, whatever the name.
  secretsFile: string
  // The folder searched for `.env*` files. Empty searches none.
  envRoot: string
  // Shorter values are common words or local database passwords, and replacing `postgres` in every
  // output would break more than it protects.
  minLength: number
}

export const DEFAULTS: Options = { enabled: true, fillCommands: true, secretsFile: '~/.secrets', envRoot: '', minLength: 12 }

// A value the secrets files declare whole is hidden from this length, below `minLength`, because a tool
// that hands out passwords, such as a vault, writes there passwords of 8 to 11 characters. Shorter
// than this, a value is a PIN or a word, and hiding it would garble ordinary output.
export const SECRETS_MIN_LENGTH = 6

// The folder beside the secrets file whose every file is a secrets file too, so a tool can keep its own
// list there without editing yours.
export function secretsDirOf(secretsFile: string): string {
  return `${secretsFile}.d`
}

// A file in the secrets folder counts unless its name starts with a dot, which is where a tool writes
// the temporary file it then renames into place.
export function isSecretsDirEntry(name: string): boolean {
  return !name.startsWith('.')
}

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const text = (key: string, fallback: string): string => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
  }
  const v: unknown = Reflect.get(values, 'minLength')
  return {
    enabled: Reflect.get(values, 'enabled') !== false,
    fillCommands: Reflect.get(values, 'fillCommands') !== false,
    secretsFile: text('secretsFile', DEFAULTS.secretsFile),
    envRoot: text('envRoot', DEFAULTS.envRoot),
    minLength: typeof v === 'number' && Number.isFinite(v) && v >= 1 ? v : DEFAULTS.minLength,
  }
}

export function expandHome(path: string, home: string | undefined): string {
  if (home === undefined) return path
  if (path === '~') return home
  return path.startsWith('~/') ? home + path.slice(1) : path
}

// `PW` came in with NEKT_PW, which none of the others matched.
export const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASS|PW|KEY|AUTH|CREDENTIAL/i

// The token that is in no list, by the format its issuer publishes.
export const FORMATS: ReadonlyArray<readonly [string, RegExp]> = [
  ['github', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['aws', /\bAKIA[0-9A-Z]{16}\b/g],
  ['slack', /\bxox[bp]-[A-Za-z0-9-]{10,}/g],
  // After `anthropic`, which already turned `sk-ant-` keys into placeholders.
  ['openai', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g],
  ['google', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['stripe', /\b[rs]k_(?:live|test)_[0-9A-Za-z]{24,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
]

// Package caches and the trash hold no `.env` anyone uses, and they are most of a home folder: on one
// machine the trash alone was 9 053 of 21 434 folders, and the scan passed the 30 s `find` limit.
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.next', '.turbo', '.yarn', 'dist', 'build', 'coverage',
  '.cache', '.npm', '.bun', 'Trash',
])

// How deep under the env root the scan goes, and from which level up a folder's mtime is watched.
export const SCAN_DEPTH = 5
export const WATCHED_FROM_DEPTH = 2

// The folders are checked for a new `.env` at most this often, unless a call touched a secret file.
export const DIRS_CHECK_MS = 60 * 1000

// The list is rebuilt at least this often even when no source changed, to catch a `.env` born in a
// folder deeper than the ones whose mtime is watched.
export const MAX_AGE_MS = 10 * 60 * 1000

// The `find` command that lists, in one process, what the folder scan needs under `root`: every folder
// and every `.env*` file, each line `<level> <type> <path>`. One process takes about half a second over a
// thousand folders, where one `$.fs.list` per folder took a median of one second and up to minutes on a
// loaded machine.
export function findArgs(root: string): string[] {
  const prune = [...SKIPPED_DIRS].flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name]))
  return ['find', root, '-maxdepth', String(SCAN_DEPTH + 1), '(', ...prune, ')', '-prune', '-o', '(', '-type', 'd', '-o', '-name', '.env*', ')', '-printf', '%d %y %p\\n']
}

// The `.env*` files and the watched folders from `findArgs`' output, as the folder walk finds them: a
// folder at level `SCAN_DEPTH - WATCHED_FROM_DEPTH` or above is watched, and a `.env*` counts when it is a
// file or a link to one (`find` types a link `l`; its target is checked by the caller).
export function parseFind(stdout: string): { files: string[]; links: string[]; dirs: string[] } {
  const files: string[] = []
  const links: string[] = []
  const dirs: string[] = []
  for (const line of stdout.split('\n')) {
    const m = /^(\d+) (\w) (.+)$/.exec(line)
    if (m === null) continue
    const level = Number(m[1])
    const type = m[2]
    const path = m[3] ?? ''
    const name = path.split('/').at(-1) ?? ''
    if (type === 'd') {
      if (level <= SCAN_DEPTH - WATCHED_FROM_DEPTH) dirs.push(path)
    } else if (level <= SCAN_DEPTH + 1 && isEnvFileName(name)) {
      if (type === 'f') files.push(path)
      else if (type === 'l') links.push(path)
    }
  }
  return { files, links, dirs }
}

// Environment variables the Perl hook's own tests set. Kept out as the Perl hook does.
const IGNORED_ENV_PREFIX = 'SEGREDO_'

export type Pair = readonly [name: string, value: string]

// The `NAME=value` lines of a dotenv or shell file, with quotes removed and a trailing comment cut.
export function assignments(text: string): Pair[] {
  const pairs: Pair[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m?.[1] === undefined || m[2] === undefined) continue
    let value = m[2]
    const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value)
    if (quoted?.[1] !== undefined) value = quoted[1]
    else value = value.replace(/\s+#.*$/, '')
    pairs.push([m[1], value])
  }
  return pairs
}

export function urlDecode(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

// The secret values one assignment yields. `anyName` is true for the secrets file, where every value
// counts whatever the name.
export function candidates(name: string, value: string, anyName: boolean): Pair[] {
  const pairs: Pair[] = []
  for (const m of value.matchAll(/:\/\/[^/\s:@]+:([^@\s/]+)@/g)) {
    const password = m[1]
    if (password === undefined) continue
    pairs.push([name, password])
    const plain = urlDecode(password)
    if (plain !== password) pairs.push([name, plain])
  }
  // In a URL the secret is the password. The whole URL is the service's address, which shows up in logs and errors.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return pairs
  // A Windows path, such as GIT_ASKPASS's, is an address too, and its pieces after a space are not secrets.
  if (/^[A-Za-z]:[\\/]/.test(value)) return pairs
  if (anyName || SECRET_NAME.test(name)) {
    pairs.push([name, value])
    // The piece is a secret too. The Coolify token has the form `id|secret`, and on 2026-10-06 the
    // shell cut it at the `|` and printed only the secret, which the list did not know alone. A short
    // piece, like the `7` of the id, fails `accepts`.
    const pieces = value.split(/[|:;,\s]+/)
    if (pieces.length > 1) for (const p of pieces) pairs.push([name, p])
  }
  return pairs
}

export function accepts(v: string, minLength: number): boolean {
  return (
    v.length >= minLength &&
    !v.startsWith('/') &&
    // A Windows path, such as GIT_ASKPASS's, as `/` above is a POSIX one.
    !/^[A-Za-z]:[\\/]/.test(v) &&
    !/[\t\n]/.test(v) &&
    !/^\$\{?\w+\}?$/.test(v) &&
    !/^<(?:hidden|oculto):/.test(v)
  )
}

export function isEnvFileName(name: string): boolean {
  return name.startsWith('.env')
}

export function isExample(path: string): boolean {
  return path.endsWith('.example')
}

// A `.env*` file by its spelling. The secrets file is matched by its real path in register.ts.
export function isEnvPath(path: string): boolean {
  return /(?:^|\/)\.env[^/]*$/.test(path)
}

// `/proc/self/environ`: NUL-separated `NAME=value` entries.
export function parseEnviron(text: string): Pair[] {
  const pairs: Pair[] = []
  for (const entry of text.split('\0')) {
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    pairs.push([entry.slice(0, eq), entry.slice(eq + 1)])
  }
  return pairs
}

export type Table = {
  // Value to the name it is shown as.
  nameOf: ReadonlyMap<string, string>
  // Name to the value a placeholder is restored to: the first accepted value of that name.
  valueOf: ReadonlyMap<string, string>
  // Every value, longest first, so a value that contains another wins.
  pattern: RegExp | null
  // Names assigned two different values (the same DATABASE_URL in two projects): a placeholder of
  // one of them cannot be filled in a command, because the mod cannot tell which value is meant.
  ambiguous: ReadonlySet<string>
}

export type EnvFile = { path: string; text: string }

export type Sources = {
  // The secrets file's text, or null when it does not exist.
  secrets: string | null
  // The files in the secrets folder.
  secretsDirFiles: readonly EnvFile[]
  envFiles: readonly EnvFile[]
  environ: readonly Pair[]
  minLength: number
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildTable(s: Sources): Table {
  // A value in a `.example` file is already public in git, like the local Postgres password.
  const published = new Set<string>()
  for (const f of s.envFiles.filter((f) => isExample(f.path))) {
    for (const [name, value] of assignments(f.text)) for (const [, v] of candidates(name, value, true)) published.add(v)
  }

  // Each candidate with the minimum length it must reach. From a secrets file, the whole value and its URL
  // passwords take the lower floor; the pieces `candidates` cuts from it keep `minLength`.
  const low = Math.min(SECRETS_MIN_LENGTH, s.minLength)
  const secretTexts = [...(s.secrets === null ? [] : [s.secrets]), ...s.secretsDirFiles.map((f) => f.text)]
  const pairs: Array<readonly [name: string, value: string, min: number]> = []
  for (const text of secretTexts) {
    for (const [n, v] of assignments(text)) {
      const isUrl = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v)
      for (const [name, value] of candidates(n, v, true)) pairs.push([name, value, isUrl || value === v ? low : s.minLength])
    }
  }
  for (const f of s.envFiles.filter((f) => !isExample(f.path))) {
    for (const [n, v] of assignments(f.text)) for (const [name, value] of candidates(n, v, false)) pairs.push([name, value, s.minLength])
  }
  const environ = s.environ.filter(([n]) => !n.startsWith(IGNORED_ENV_PREFIX)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  for (const [n, v] of environ) for (const [name, value] of candidates(n, v, false)) pairs.push([name, value, s.minLength])

  // The whole value of each assignment, before the pieces `candidates` adds.
  const wholes = new Map<string, Set<string>>()
  const whole = (n: string, v: string, anyName: boolean, min: number) => {
    const first = candidates(n, v, anyName)[0]
    if (first === undefined || published.has(first[1]) || !accepts(first[1], min)) return
    wholes.set(first[0], (wholes.get(first[0]) ?? new Set()).add(first[1]))
  }
  for (const text of secretTexts) for (const [n, v] of assignments(text)) whole(n, v, true, low)
  for (const f of s.envFiles.filter((f) => !isExample(f.path))) for (const [n, v] of assignments(f.text)) whole(n, v, false, s.minLength)
  for (const [n, v] of environ) whole(n, v, false, s.minLength)
  const ambiguous = new Set([...wholes].filter(([, vs]) => vs.size > 1).map(([n]) => n))

  const nameOf = new Map<string, string>()
  const valueOf = new Map<string, string>()
  for (const [name, value, min] of pairs) {
    if (published.has(value) || !accepts(value, min)) continue
    if (!nameOf.has(value)) nameOf.set(value, name)
    if (!valueOf.has(name)) valueOf.set(name, value)
  }
  return { nameOf, valueOf, pattern: patternOf([...nameOf.keys()]), ambiguous }
}

function patternOf(values: readonly string[]): RegExp | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  return new RegExp(sorted.map(escape).join('|'), 'g')
}

// Counts per name of what was hidden.
export type Found = Map<string, number>

function bump(found: Found, name: string) {
  found.set(name, (found.get(name) ?? 0) + 1)
}

export function placeholder(name: string): string {
  return `<hidden:${name}>`
}

export function redactText(text: string, t: Table, found: Found): string {
  let out = text
  if (t.pattern !== null) {
    out = out.replace(t.pattern, (v) => {
      const name = t.nameOf.get(v) ?? 'secret'
      bump(found, name)
      return placeholder(name)
    })
  }
  for (const [name, re] of FORMATS) {
    out = out.replace(re, () => {
      bump(found, name)
      return placeholder(name)
    })
  }
  return out
}

// Every string inside arrays and plain objects. Returns the same reference when nothing changed, so the
// caller can tell a result it must rewrite from one it can pass on.
export function redactDeep(data: unknown, t: Table, found: Found): unknown {
  if (typeof data === 'string') return redactText(data, t, found)
  if (Array.isArray(data)) {
    let changed = false
    const out = data.map((item: unknown) => {
      const r = redactDeep(item, t, found)
      if (r !== item) changed = true
      return r
    })
    return changed ? out : data
  }
  if (typeof data === 'object' && data !== null) {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      const r = redactDeep(v, t, found)
      if (r !== v) changed = true
      out[k] = r
    }
    return changed ? out : data
  }
  return data
}

// Puts the real value back where the agent wrote a placeholder. The earlier Perl hook, which may still
// run beside this mod, writes `<oculto:NAME>` (Portuguese for hidden), so both spellings are restored.
export function restoreText(text: string, valueOf: ReadonlyMap<string, string>, restored: Set<string>): string {
  return text.replace(/<(?:hidden|oculto):([A-Za-z0-9_]+)>/g, (whole, name: string) => {
    const v = valueOf.get(name)
    if (v === undefined) return whole
    restored.add(name)
    return v
  })
}

// A Bash command with each `<hidden:NAME>` filled in with its value, so the agent can use a secret it
// never sees: the transcript keeps the command as written, and the output is redacted as usual. A
// placeholder the mod cannot fill (a token known only by its format, or a name with two values)
// lands in `unfilled`, and the caller refuses the command instead of running it half filled.
export type Filled = { command: string; filled: string[]; unfilled: string[] }

export function fillCommand(command: string, t: Table): Filled {
  const filled = new Set<string>()
  const unfilled = new Set<string>()
  const out = command.replace(/<(?:hidden|oculto):([A-Za-z0-9_-]+)>/g, (whole, name: string) => {
    const v = t.valueOf.get(name)
    if (v === undefined || t.ambiguous.has(name)) {
      unfilled.add(name)
      return whole
    }
    filled.add(name)
    return v
  })
  return { command: out, filled: [...filled].sort(), unfilled: [...unfilled].sort() }
}

export function unfilledText(names: readonly string[], t: Table): string {
  const why = names.map((n) => (t.ambiguous.has(n) ? `${n} has two different values in your files` : `the value of ${n} is not known, only its format`))
  return (
    `secret-guard: did not run the command, because it cannot fill in ${names.map(placeholder).join(', ')}: ${why.join('; ')}. ` +
    'Read the value inside the command instead, from its variable or .env file (for example `set -a; . ./.env; set +a` before the command), so it never shows in the transcript.'
  )
}

export function fillOffText(names: readonly string[]): string {
  return (
    `secret-guard: did not run the command, because filling placeholders in commands is off, and it names ${names.map(placeholder).join(', ')}. ` +
    'Read the value inside the command instead, from its variable or .env file (for example `set -a; . ./.env; set +a` before the command), so it never shows in the transcript.'
  )
}

export function filledNotice(names: readonly string[]): string {
  return `secret-guard: filled in the real value of ${names.join(', ')} in the command. The transcript keeps the placeholder, and the output is hidden as usual.`
}

// The name-to-value map for restoring in one file: the file's own assignments win, because the same
// name in two `.env` files with different values resolves by the file being edited.
export function valuesForFile(t: Table, fileText: string | null, isSecretsFile: boolean, minLength: number): Map<string, string> {
  const own = new Map<string, string>()
  if (fileText !== null) {
    for (const [n, v] of assignments(fileText)) {
      for (const [name, value] of candidates(n, v, isSecretsFile)) {
        if (accepts(value, minLength) && !own.has(name)) own.set(name, value)
      }
    }
  }
  return new Map([...t.valueOf, ...own])
}

export function sortedNames(found: Found): string[] {
  return [...found.keys()].sort()
}

export function total(found: Found): number {
  let n = 0
  for (const c of found.values()) n += c
  return n
}

export function redactedNotice(names: readonly string[]): string {
  const list = names.join(', ')
  return (
    `secret-guard: replaced the value of ${list} in this output with <hidden:NAME>. ` +
    'Use the placeholder as is; written into a .env or secrets file, it becomes the real value. ' +
    `If you see the real value anywhere, tell the user ${list} leaked into the transcript and must be rotated.`
  )
}

export const RESTORED_NOTICE =
  'secret-guard: the file got the real value in place of each <hidden:NAME>. Tool output keeps showing the placeholder.'
