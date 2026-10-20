// The rules of the skill-loader mod, without the mods API, so the tests can run them directly.

export type Options = {
  // Off, the mod registers no hook.
  enabled: boolean
  // Off, a write, a commit or a PR runs at once, and the skill comes with its result instead of in a refusal.
  holdWrites: boolean
  // Off, an error pasted in the prompt gets no diagnosing-bugs reminder.
  diagnoseReminder: boolean
}

export const DEFAULTS: Options = { enabled: true, holdWrites: true, diagnoseReminder: true }

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  const on = (key: string): boolean => Reflect.get(values, key) !== false
  return { enabled: on('enabled'), holdWrites: on('holdWrites'), diagnoseReminder: on('diagnoseReminder') }
}

export type Trigger = {
  skill: string
  // A file that, when read, edited or written, calls for the skill.
  path?: RegExp
  // A Bash command that calls for the skill before it runs.
  command?: RegExp
}

// Replaces the "skills you load on the spot" section of the global CLAUDE.md.
export const TRIGGERS: readonly Trigger[] = [
  { skill: 'typescript-best-practices', path: /\.(ts|tsx|mts|cts)$/ },
  { skill: 'writing-for-agents', path: /(^|\/)(SKILL|AGENTS|CLAUDE)\.md$/ },
  { skill: 'domain-modeling', path: /(^|\/)CONTEXT(-MAP)?\.md$|(^|\/)(adr|adrs|decisions)\/[^/]+\.md$/i },
  { skill: 'technical-writing', path: /(^|\/)README[^/]*\.md$/i, command: /(^|[;&|(]\s*)(git\s+commit\b|gh\s+pr\s+(create|edit)\b)/ },
]

export const READ_TOOLS = new Set(['Read'])
export const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Files no one writes by hand: installed packages, the types Claude Code lays for mods and skills. Reading
// one is looking up an API, not working on the code.
const GENERATED = /(^|\/)(node_modules|bundled-skills)\/|\/\.claude-plugin\/types\//

export function byTool(tool: string, path: string): Trigger | null {
  if (!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool)) return null
  // A Windows path (`C:\w\SKILL.md`) is matched with forward slashes, as the patterns spell it.
  const p = path.replaceAll('\\', '/')
  if (GENERATED.test(p)) return null
  return TRIGGERS.find((t) => t.path?.test(p) === true) ?? null
}

// The command without heredoc bodies and without quoted text, so a quoted `git commit` does not count.
function executable(command: string): string {
  const outside: string[] = []
  let end: string | null = null
  for (const line of command.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null
      continue
    }
    const heredoc = /<<-?\s*['"]?(\w+)['"]?/.exec(line)
    if (heredoc?.[1] !== undefined) end = heredoc[1]
    outside.push(line)
  }
  return outside.join('\n').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
}

export function byCommand(command: string): Trigger | null {
  const clean = executable(command)
  return TRIGGERS.find((t) => t.command?.test(clean) === true) ?? null
}

// Signs that the user pasted an error or said something broke. The user writes in Portuguese, so the
// Portuguese phrases stay next to the English ones. A phrase in a question ("isso não funciona por
// Remote Control?") asks whether something works, and does not count.
const ERROR_SIGNS = [
  /\b\w*(Error|Exception):\s/,
  /Traceback \(most recent call last\)/,
  /^\s+at\s+\S+.*:\d+:\d+\)?$/m,
  /\bexit code [1-9]\d*\b/i,
  /\b(quebrou|quebrado|parou de funcionar|não funciona|nao funciona|deu erro|tá dando erro|ta dando erro)\b(?![^.!\n]*\?)/i,
  /\b(broke|is broken|not working|stopped working)\b(?![^.!\n]*\?)/i,
]

export function looksLikeError(text: string): boolean {
  return ERROR_SIGNS.some((re) => re.test(text))
}

export const BUG_REMINDER = 'skill-loader: the user pasted an error or said something broke. Load the skill-loader:diagnosing-bugs skill before investigating.'

// A skill's name without its plugin prefix: `skill-loader:diagnosing-bugs` and
// `mattpocock-skills:diagnosing-bugs` both count as `diagnosing-bugs`, the same text.
export function bareSkill(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1)
}

// The context note that delivers a skill with a read. It starts with `The skill <name>`, so the skills a
// turn used can be counted from the transcript.
export function loadedText(skill: string, body: string): string {
  return `The skill ${skill} follows in full, loaded by skill-loader. Follow it from here on.\n\n${body}`
}

export function refusalText(skill: string, target: string, body: string): string {
  return `skill-loader: the ${skill} skill applies to ${target} and follows in full. Read it, then repeat the call following it.\n\n${body}`
}

export function alreadyDeliveredText(skill: string): string {
  return `skill-loader: ${skill} already came in full earlier in this conversation. Follow that text.`
}

// The SKILL.md as the Skill tool delivers it: the skill's directory, for relative paths, and the body without the frontmatter.
// The folder Claude Code installed this plugin in, from `plugins/installed_plugins.json`: the
// `installPath` of the first `skill-loader@<marketplace>` entry. Null when the file names none.
export function installPathOf(json: string, plugin: string): string | null {
  try {
    const plugins: unknown = Reflect.get(JSON.parse(json) as object, 'plugins')
    if (typeof plugins !== 'object' || plugins === null) return null
    for (const [key, entries] of Object.entries(plugins)) {
      if (!key.startsWith(`${plugin}@`) || !Array.isArray(entries)) continue
      for (const entry of entries as unknown[]) {
        const path: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'installPath') : undefined
        if (typeof path === 'string' && path !== '') return path
      }
    }
    return null
  } catch {
    return null
  }
}

export function asSkill(dir: string, content: string): string {
  // `\r?` because a Windows checkout can end its lines with CRLF.
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
  return `Base directory for this skill: ${dir}\n\n${body}`
}
