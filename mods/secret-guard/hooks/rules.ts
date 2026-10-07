// The rules of the secret-guard mod, without the mods API, so the tests can run them directly.
//
// Ported from an earlier Perl hook. The values come from the secrets file, from the `.env*` files under
// the env root when one is set, from the environment variables with a secret-looking name, and from
// the password of every `scheme://user:password@` URL. A value is replaced by `<hidden:NAME>` in every tool result.

export type Options = {
  // A KEY=value file whose every value is a secret, whatever the name.
  secretsFile: string
  // The folder searched for `.env*` files. Empty searches none.
  envRoot: string
  // Shorter values are common words or local database passwords, and replacing `postgres` in every
  // output would break more than it protects.
  minLength: number
}

export const DEFAULTS: Options = { secretsFile: '~/.secrets', envRoot: '', minLength: 12 }

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const text = (key: string, fallback: string): string => {
    const v: unknown = Reflect.get(values, key)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
  }
  const v: unknown = Reflect.get(values, 'minLength')
  return {
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
]

export const SKIPPED_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', '.next', '.turbo', '.yarn', 'dist', 'build', 'coverage'])

// How deep under the env root the scan goes, and from which level up a folder's mtime is watched.
export const SCAN_DEPTH = 5
export const WATCHED_FROM_DEPTH = 2

// The folders are checked for a new `.env` at most this often, unless a call touched a secret file.
export const DIRS_CHECK_MS = 60 * 1000

// The list is rebuilt at least this often even when no source changed, to catch a `.env` born in a
// folder deeper than the ones whose mtime is watched.
export const MAX_AGE_MS = 10 * 60 * 1000

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
}

export type EnvFile = { path: string; text: string }

export type Sources = {
  // The secrets file's text, or null when it does not exist.
  secrets: string | null
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

  const pairs: Pair[] = []
  if (s.secrets !== null) for (const [n, v] of assignments(s.secrets)) pairs.push(...candidates(n, v, true))
  for (const f of s.envFiles.filter((f) => !isExample(f.path))) {
    for (const [n, v] of assignments(f.text)) pairs.push(...candidates(n, v, false))
  }
  const environ = s.environ.filter(([n]) => !n.startsWith(IGNORED_ENV_PREFIX)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  for (const [n, v] of environ) pairs.push(...candidates(n, v, false))

  const nameOf = new Map<string, string>()
  const valueOf = new Map<string, string>()
  for (const [name, value] of pairs) {
    if (published.has(value) || !accepts(value, s.minLength)) continue
    if (!nameOf.has(value)) nameOf.set(value, name)
    if (!valueOf.has(name)) valueOf.set(name, value)
  }
  return { nameOf, valueOf, pattern: patternOf([...nameOf.keys()]) }
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
