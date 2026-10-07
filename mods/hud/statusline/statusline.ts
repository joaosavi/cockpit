// The hud's rows under the prompt, as a Claude Code status line command. Claude Code pipes the
// session's JSON in (model, folder, context window, plan limits); the mod leaves the tool call count
// in a live file; this script reads git and the cgroup memory itself. Run by statusline.sh, which
// sets COLUMNS. Node 22.18+ runs this TypeScript as is.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { ansiRow, compactWindowOf, type Git, groups, inactiveFile, type Level, MEMORY_MARGIN, type Memory, memory, meminfo, numberOrMax, options, panelRows, parseGit, parseLive, statusSession, statusSnapshot, styleOf } from '../hooks/rules.ts'

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
  // `hud@agent` when installed from the marketplace, `hud@inline` under --plugin-dir.
  const key = typeof configs === 'object' && configs !== null ? (Object.keys(configs).find((k) => k === 'hud@agent') ?? Object.keys(configs).find((k) => k.startsWith('hud@'))) : undefined
  const hud: unknown = key === undefined ? undefined : Reflect.get(configs as object, key)
  return options(typeof hud === 'object' && hud !== null ? Reflect.get(hud, 'options') : undefined)
}

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
const snapshot = statusSnapshot(input, live, { now: Date.now(), timeZone: o.timeZone, git: readGit(dir), memory: o.memory ? readMemory() : null, compactWindow, style })
const columns = Number(process.env['COLUMNS'])
process.stdout.write(panelRows(snapshot, Number.isFinite(columns) && columns > 20 ? columns : 120).map((r) => ansiRow(r, style.colors)).join('\n') + '\n')
