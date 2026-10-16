// The hud's rows under the prompt, as a Claude Code status line command. Claude Code pipes the
// session's JSON in (model, folder, context window, plan limits); the mod leaves the tool call count
// in a live file; this script reads git and the memory itself: cgroups and /proc/meminfo on Linux,
// `vm_stat` on macOS, and Node's own figures on Windows. Run by statusline.sh, which
// sets HUD_WIDTH, or by `node statusline.ts` directly where there is no POSIX shell, as on Windows
// without Git Bash. Node 22.18+ runs this TypeScript as is.

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { freemem, homedir, totalmem } from 'node:os'
import { statusRows } from '../hooks/styles.ts'
import { ansiRow, compactWindowOf, type Git, groups, inactiveFile, type Level, type Machine, MEMORY_MARGIN, type Memory, macMemory, memory, meminfo, numberOrMax, options, parseGit, parseLive, parsePr, type Pr, statusSession, statusSnapshot, styleOf } from '../hooks/rules.ts'

// The folder the mod writes under: HOME, or the user's profile folder on Windows, where HOME is usually
// unset. The mod reads the same two variables in that order.
const HOME = process.env['HOME'] || homedir()

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

// What the `sh` line does, in Node: the PR as JSON into the file given as the argument, or `{}`.
const PR_SCRIPT = `const { execFileSync } = require('node:child_process')
const { renameSync, writeFileSync } = require('node:fs')
const file = process.argv[1]
let out = '{}'
try {
  out = execFileSync('gh', ['pr', 'view', '--json', 'number,state,statusCheckRollup'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true })
} catch {}
writeFileSync(file + '.tmp', out)
renameSync(file + '.tmp', file)`

// The branch's open PR from the cache, refreshed in a detached `gh` run when the cache is stale.
function readPr(dir: unknown, git: Git | null): Pr | null {
  if (typeof dir !== 'string' || dir === '' || git === null) return null
  const cacheDir = `${HOME}/.local/state/mods/hud/pr`
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
      // Windows has no `sh`, so there a second Node runs `gh` and swaps the file in.
      const child =
        process.platform === 'win32'
          ? spawn(process.execPath, ['-e', PR_SCRIPT, file], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true })
          : spawn('sh', ['-c', 'gh pr view --json number,state,statusCheckRollup > "$1.tmp" 2>/dev/null && mv "$1.tmp" "$1" || { echo "{}" > "$1"; rm -f "$1.tmp"; }', 'sh', file], { cwd: dir, detached: true, stdio: 'ignore' })
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
  return memory(levels, info === null ? otherMachine() : meminfo(info), MEMORY_MARGIN)
}

// The machine without /proc/meminfo. On Windows, Node's free memory is the available physical memory
// of GlobalMemoryStatusEx. On macOS it counts only free pages, so the script asks `vm_stat` for the
// inactive, speculative and purgeable ones too.
function otherMachine(): Machine | null {
  try {
    if (process.platform === 'win32') {
      const total = totalmem()
      return total > 0 ? { total, available: Math.min(total, freemem()) } : null
    }
    if (process.platform !== 'darwin') return null
    const pages = execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
    return macMemory(String(totalmem()), pages)
  } catch {
    return null
  }
}

// The user settings, where /config saves the hud's options and /autocompact its window.
function userSettings(): object {
  const dir = process.env['CLAUDE_CONFIG_DIR'] ?? `${HOME}/.claude`
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
const live = id === null ? null : parseLive(read(`${HOME}/.local/state/mods/hud/live/${id}.json`) ?? '')
const dir = typeof input === 'object' && input !== null ? (Reflect.get(Reflect.get(input, 'workspace') ?? {}, 'current_dir') ?? Reflect.get(input, 'cwd')) : undefined
const git = readGit(dir)
const snapshot = { ...statusSnapshot(input, live, { now: Date.now(), timeZone: o.timeZone, git, memory: o.memory ? readMemory() : null, compactWindow, style }), pr: readPr(dir, git) }
// HUD_WIDTH from statusline.sh is already the drawable width. Run directly, the script takes off the
// 4 columns Claude Code pads the status line with from COLUMNS itself, as statusline.sh does.
const shWidth = Number(process.env['HUD_WIDTH'])
const terminal = Number(process.env['COLUMNS'])
const columns = process.env['HUD_WIDTH'] !== undefined ? shWidth : terminal > 24 ? terminal - 4 : Number.NaN
process.stdout.write(statusRows(snapshot, o.style, o.icons, Number.isFinite(columns) && columns > 20 ? columns : 116, o.barColor).map((r) => ansiRow(r, style.colors)).join('\n') + '\n')
