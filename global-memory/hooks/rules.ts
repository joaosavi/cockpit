// Pure text work for the global-memory mod: reading the memory section core sends, rewriting it to
// describe two folders, and building the global MEMORY.md entry for the instruction files. Nothing
// here reads the clock or the disk, so the same input always gives the same text, which keeps the
// prompt cache warm.

import type { InstructionFile, PluginOptions } from 'claude-code'

export const INDEX = 'MEMORY.md'
export const DEFAULT_DIR = '~/.claude/global-memory'
// Core cuts MEMORY.md at 200 lines and 25,000 bytes before it reaches the model.
const MAX_LINES = 200
const MAX_CHARS = 25000

export type Mode = 'writable' | 'read-only'

// Core's two sentences after the folder path: one for a folder it lets the agent write, one for a
// read-only folder. Any other wording is a variant this mod does not know, and it leaves it alone.
const WRITABLE = 'This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).'
const READ_ONLY = 'This memory is read-only this session — you cannot save new memories to it.'

// The full section says "memory system at"; the short one, for lean prompts, "memory at".
const OPENING = /You have a persistent(,?) file-based memory( system)? at `([^`]+)`\. ([^\n]*?)(?=$|\n| Each memory is one file)/

export type Parsed = { projectDir: string; mode: Mode; opening: string; isFull: boolean }

// The project folder and the mode core chose, read from the section's opening sentence.
export function parseSection(text: string): Parsed | null {
  const m = OPENING.exec(text)
  if (m === null) return null
  const [opening, comma, system, projectDir, rest] = m
  if (opening === undefined || projectDir === undefined || rest === undefined) return null
  const mode: Mode | null = rest === WRITABLE ? 'writable' : rest === READ_ONLY ? 'read-only' : null
  if (mode === null) return null
  return { projectDir, mode, opening, isFull: comma === ',' && system === ' system' }
}

// `~`, `~/...` and Windows' `~\\...` resolved against HOME; null when HOME is needed and missing.
export function expandHome(path: string, home: string | undefined): string | null {
  if (path !== '~' && !path.startsWith('~/') && !path.startsWith('~\\')) return path
  if (home === undefined || home === '') return null
  return home.replace(/[\\/]+$/, '') + path.slice(1)
}

// The global folder from the plugin options, without a trailing slash.
export function globalDir(values: PluginOptions, home: string | undefined): string | null {
  const raw = values.globalDir
  const path = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_DIR
  const expanded = expandHome(path, home)
  if (expanded === null) return null
  const trimmed = expanded.replace(/[\\/]+$/, '')
  return trimmed === '' ? null : trimmed
}

function openingSentence(p: Parsed, global: string): string {
  const lead = p.isFull ? 'You have a persistent, file-based memory system' : 'You have a persistent file-based memory'
  const where = `with two directories: a project directory at \`${p.projectDir}\` and a machine-wide global directory at \`${global}\`.`
  const tail =
    p.mode === 'writable'
      ? 'Both directories already exist — write to them directly with the Write tool (do not run mkdir or check for their existence).'
      : 'This memory is read-only this session — you cannot save new memories to either directory.'
  return `${lead} ${where} ${tail}`
}

// The scope block, modeled on core's team-memory "Memory scope" section with "team" swapped for
// "global". The read-only form describes where memories live and grants no saving.
export function scopeBlock(p: Parsed, global: string, hasIndex: boolean): string {
  const levels = [
    `- project: memories that apply only to the current project. They persist across conversations opened in this project and are stored at the root \`${p.projectDir}\`.`,
    `- global: memories that are true for the whole machine, whatever folder a session is opened in. They persist across conversations in every project on this machine and are stored at \`${global}\`.`,
  ]
  if (p.mode === 'read-only') return ['## Memory scope', '', 'There are two scope levels, both read-only this session:', '', ...levels].join('\n')
  return [
    '## Memory scope',
    '',
    'There are two scope levels:',
    '',
    ...levels,
    '',
    'Choose the directory by type:',
    '',
    '- `user` and `feedback`: default to global. Save them in the project directory only when they apply only to this project.',
    '- `reference`: global when it is about the machine, its tools, access or services; project when it points to something only this project uses.',
    '- `project`: always the project directory.',
    '',
    ...(hasIndex ? [`Each directory has its own \`${INDEX}\` index. Add the pointer to the \`${INDEX}\` of the directory where you saved the memory.`, ''] : []),
    '- Before saving, check both directories for an existing memory that covers it, and update that file rather than writing the same fact in the other directory.',
    '- You MUST avoid saving sensitive data within the global directory: every session on this machine reads it. For example, never save API keys or user credentials.',
  ].join('\n')
}

// Core sentences that assume one folder, and their two-folder wording. A sentence missing from the
// incoming text is skipped, so a core that words them differently still gets the scope block.
const EDITS: readonly (readonly [string, string])[] = [
  [`add a pointer to that file in \`${INDEX}\`.`, `add a pointer to that file in the \`${INDEX}\` of the directory where you saved it.`],
  [`add a one-line pointer in \`${INDEX}\``, `add a one-line pointer in the \`${INDEX}\` of the directory where you saved it`],
  [`- \`${INDEX}\` is always loaded into your conversation context`, `- Both \`${INDEX}\` files are always loaded into your conversation context`],
  ['- When memories seem relevant,', '- When memories (project or global) seem relevant,'],
  ['First check if there is an existing memory you can update', 'First check both directories for an existing memory you can update'],
]

// Where the scope block goes: before the first of these headings, as in core's team prompt; at
// the end when none is there (the short section has no headings).
const ANCHORS = ['## Types of memory', '## What NOT to save in memory', '## How to save memories']

// The section rewritten for two folders, in the mode core chose; null when the text is not one of
// core's known memory sections.
export function rewriteSection(text: string, global: string): { text: string; mode: Mode } | null {
  const p = parseSection(text)
  if (p === null) return null
  const shown = /[\\/]$/.test(global) ? global : `${global}/`
  let out = text.replace(p.opening, openingSentence(p, shown))
  for (const [from, to] of EDITS) out = out.replace(from, to)
  const block = scopeBlock(p, shown, text.includes(`\`${INDEX}\``))
  const at = ANCHORS.map((a) => out.indexOf(`\n${a}`)).filter((i) => i >= 0)
  if (at.length > 0) {
    const i = Math.min(...at) + 1
    out = `${out.slice(0, i)}${block}\n\n${out.slice(i)}`
  } else {
    out = `${out.replace(/\n+$/, '')}\n\n${block}\n`
  }
  return { text: out, mode: p.mode }
}

// MEMORY.md as core loads an auto-memory index: frontmatter and HTML comments out, cut at 200
// lines and 25,000 characters with a warning line.
export function indexContent(raw: string): string {
  const body = raw
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  const lines = body.split('\n')
  let kept = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES).join('\n') : body
  if (kept.length > MAX_CHARS) {
    const cut = kept.lastIndexOf('\n', MAX_CHARS)
    kept = kept.slice(0, cut > 0 ? cut : MAX_CHARS)
  }
  if (kept === body) return body
  return `${kept}\n> WARNING: ${INDEX} is ${lines.length} lines and ${body.length} characters (limit: ${MAX_LINES} lines, ${MAX_CHARS} characters). Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`
}

// The instruction files with the global index added after the last memory entry, or at the end.
// Unchanged when the index is already there.
export function withGlobalIndex(files: readonly InstructionFile[], entry: InstructionFile): readonly InstructionFile[] {
  if (files.some((f) => f.path === entry.path)) return files
  let last = -1
  files.forEach((f, i) => {
    if (f.kind === 'memory') last = i
  })
  const at = last < 0 ? files.length : last + 1
  return [...files.slice(0, at), entry, ...files.slice(at)]
}
