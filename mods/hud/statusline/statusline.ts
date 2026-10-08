// The hud's rows under the prompt, as a Claude Code status line command. Claude Code pipes the
// session's JSON in (model, folder, context window, plan limits); the mod leaves the tool call count
// in a live file; this script reads git and the cgroup memory itself. Run by statusline.sh, which
// sets COLUMNS. Node 22.18+ runs this TypeScript as is.

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { statusRows } from '../hooks/styles.ts'
import { ansiRow, compactWindowOf, type Git, groups, inactiveFile, type Level, MEMORY_MARGIN, type Memory, memory, meminfo, numberOrMax, options, parseGit, parseLive, parsePr, type Pr, statusSession, statusSnapshot, styleOf } from '../hooks/rules.ts'

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function readGit(dir: unknown): Git | null {
  if (typeof dir !== 'string' || dir === '') return null
  try {
    return parseGit(execFileSync('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v2', '--branch'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch {
    return null
  }
}

// How long a PR reading stays fresh. `gh` takes about a second, so it runs in the background and the
// status line shows the last reading until the new one lands.
const PR_TTL_MS = 60_000

// The branch's open PR from the cache, refreshed in a detached `gh` run when the cache is stale.
function readPr(dir: unknown, git: Git | null): Pr | null {
  if (typeof dir !== 'string' || dir === '' || git === null) return null
  const cacheDir = `${homedir()}/.local/state/mods/hud/pr`
  const file = `${cacheDir}/${createHash('sha1').update(`${dir}\0${git.branch}`).digest('hex').slice(0, 16)}.json`
  let age = Infinity
  try {
    age = Date.now() - statSync(file).mtimeMs
  } catch {
    // no reading yet
  }
  if (age > PR_TTL_MS) {
    try {
      mkdirSync(cacheDir, { recursive: true })
      // Touch the file first, so the redraws during this run do not start another one.
      if (age === Infinity) writeFileSync(file, '{}')
      else writeFileSync(file, read(file) ?? '{}')
      const child = spawn('sh', ['-c', 'gh pr view --json number,state,statusCheckRollup > "$1.tmp" 2>/dev/null && mv "$1.tmp" "$1" || { echo "{}" > "$1"; rm -f "$1.tmp"; }', 'sh', file], { cwd: dir, detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
    } catch {
      // no gh or no cache folder: no PR shown
    }
  }
  return parsePr(read(file) ?? '')
}

function readMemory(): Memory | null {
  const levels: Level[] = []
  for (const group of groups(read('/proc/self/cgroup') ?? '')) {
    const dir = '/sys/fs/cgroup' + group
    const current = numberOrMax(read(dir + '/memory.current') ?? '')
    if (current === null) continue
    const inactive = inactiveFile(read(dir + '/memory.stat') ?? '')
    levels.push({ group, used: Math.max(0, current - inactive), high: numberOrMax(read(dir + '/memory.high') ?? ''), max: numberOrMax(read(dir + '/memory.max') ?? '') })
  }
  const info = read('/proc/meminfo')
  return memory(levels, info === null ? null : meminfo(info), MEMORY_MARGIN)
}

// The user settings, where /config saves the hud's options and /autocompact its window.
function userSettings(): object {
  const dir = process.env['CLAUDE_CONFIG_DIR'] ?? `${homedir()}/.claude`
  try {
    const settings: unknown = JSON.parse(read(`${dir}/settings.json`) ?? '{}')
    return typeof settings === 'object' && settings !== null ? settings : {}
  } catch {
    return {}
  }
}

function hudOptions(settings: object) {
  const configs: unknown = Reflect.get(settings, 'pluginConfigs')
  // `hud@cockpit` when installed from the marketplace, `hud@inline` under --plugin-dir.
  const key = typeof configs === 'object' && configs !== null ? (Object.keys(configs).find((k) => k === 'hud@cockpit') ?? Object.keys(configs).find((k) => k.startsWith('hud@'))) : undefined
  const hud: unknown = key === undefined ? undefined : Reflect.get(configs as object, key)
  return options(typeof hud === 'object' && hud !== null ? Reflect.get(hud, 'options') : undefined)
}

// A reader that closes the pipe early (a pager, head) is not an error worth a stack trace.
process.stdout.on('error', () => {})

let input: unknown = null
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  // an empty or broken input still draws what the script reads itself
}
const settings = userSettings()
const o = hudOptions(settings)
const style = styleOf(o)
const compactWindow = o.contextBase === 'compact' ? compactWindowOf(process.env['CLAUDE_CODE_AUTO_COMPACT_WINDOW'], Reflect.get(settings, 'autoCompactWindow')) : null
const id = statusSession(input)
const live = id === null ? null : parseLive(read(`${homedir()}/.local/state/mods/hud/live/${id}.json`) ?? '')
const dir = typeof input === 'object' && input !== null ? (Reflect.get(Reflect.get(input, 'workspace') ?? {}, 'current_dir') ?? Reflect.get(input, 'cwd')) : undefined
const git = readGit(dir)
const snapshot = { ...statusSnapshot(input, live, { now: Date.now(), timeZone: o.timeZone, git, memory: o.memory ? readMemory() : null, compactWindow, style }), pr: readPr(dir, git) }
const columns = Number(process.env['COLUMNS'])
process.stdout.write(statusRows(snapshot, o.style, o.icons, Number.isFinite(columns) && columns > 20 ? columns : 120, o.barColor).map((r) => ansiRow(r, style.colors)).join('\n') + '\n')
