// Keeps Claude Code's native task list in front of the agent. The list lives on disk, so it outlives
// a compaction, but the model forgets it is there: this mod shows the open tasks when the session
// starts and right after each compaction, reminds the agent on each prompt from the user that a new
// request becomes a task first, and logs completed tasks to an archive.
//
// The list is read from the files Claude Code writes, never from the model, so a task a script wrote
// straight into the folder shows up too. The app's task panel reads only the session's own task calls,
// so the mod keeps a copy of what the panel holds and asks the session for the TaskUpdate calls that
// bring it back in line (see rules.ts). The mod never deletes a task file: Claude Code hands out the
// next id from the highest file or from `.highwatermark`, which only its own delete raises, so a file
// removed any other way gives its id to the next task. A completed task leaves through TaskUpdate.
//
// The diary records each action, and at the end of the session one summary line with the counts.

import type { Hook, On, PluginOptions } from 'claude-code'
import {
  archiveEntry,
  byId,
  cleanListId,
  createdId,
  DEFAULTS,
  isCompacted,
  openTasksNote,
  type Options,
  options,
  type Panel,
  panelCalls,
  panelCreate,
  panelFromMessages,
  panelNote,
  panelUpdate,
  parseTask,
  promptContext,
  REQUEST_ORIGINS,
  withUnknown,
  type Task,
  taskUpdate,
} from './rules.ts'
import { countAction, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = DEFAULTS
let stateDir = ''
let diary = ''
let cwd = ''
let tally = newTally()
// Tasks archived since the model last read the list, for the next prompt to name.
let unseen: Task[] = []
// The app's task panel for the session named, as the session's calls left it.
let panel: { session: string; value: Panel } | null = null

const HOUR_MS = 3_600_000

// One diary line. Every mod's diary line starts with `at`, `session` and `event`. The session id is read
// on each write, because `/clear` and `/resume` change it without reloading the mod.
async function appendLine($: Api, path: string, entry: Record<string, unknown>) {
  let before = ''
  try {
    before = await $.fs.read(path)
  } catch {
    // the file's first line
  }
  const at = new Date(await $.clock.now()).toISOString()
  const session = (await $.session.id()).slice(0, 8)
  await $.fs.write(path, before + JSON.stringify({ at, session, ...entry }) + '\n')
}

async function act($: Api, action: string, extra: Record<string, unknown> = {}) {
  countAction(tally, action)
  if (diary === '') return
  try {
    await appendLine($, diary, { event: action, ...extra })
  } catch {
    // a diary that cannot be written changes nothing else
  }
}

// The list this session writes to: the named list when CLAUDE_CODE_TASK_LIST_ID is set, the session's
// own otherwise. Read on each use, because `/clear` changes the session id without reloading the mod.
async function currentList($: Api): Promise<{ id: string; isNamed: boolean; dir: string } | null> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home === undefined ? undefined : `${home}/.claude`)
  if (config === undefined) return null
  const named = await $.env.get('CLAUDE_CODE_TASK_LIST_ID')
  const isNamed = named !== undefined && named.trim() !== ''
  const id = cleanListId(isNamed ? named.trim() : await $.session.id())
  return { id, isNamed, dir: `${config}/tasks/${id}` }
}

type Read = { open: Task[]; done: Task[] }

async function readList($: Api, dir: string): Promise<Read> {
  const out: Read = { open: [], done: [] }
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return out
  }
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name.startsWith('.')) continue
    const path = `${dir}/${f.name}`
    let task: Task | null = null
    try {
      task = parseTask(await $.fs.read(path))
    } catch {
      // gone between the listing and the read
    }
    if (task === null) continue
    if (task.status === 'completed') out.done.push(task)
    else out.open.push(task)
  }
  out.open.sort(byId)
  return out
}

// The completed tasks already logged, by id, with the subject and the time the mod first saw each one
// completed. One file per list, next to the archive log.
type Done = Record<string, { subject: string; at: number }>

async function readJson($: Api, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

async function readDone($: Api, list: string): Promise<Done> {
  const raw = await readJson($, `${stateDir}/${list}.done.json`)
  const out: Done = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [id, v] of Object.entries(raw)) {
    const subject: unknown = typeof v === 'object' && v !== null ? Reflect.get(v, 'subject') : undefined
    const at: unknown = typeof v === 'object' && v !== null ? Reflect.get(v, 'at') : undefined
    if (typeof subject === 'string' && typeof at === 'number') out[id] = { subject, at }
  }
  return out
}

// Logs each completed task once, and answers the ones logged now and the ones past keepCompletedHours.
// An entry whose file is gone leaves the record. A failed log write keeps the task for the next sweep.
async function archive($: Api, list: string, done: readonly Task[]): Promise<{ logged: Task[]; expired: Set<string> }> {
  const expired = new Set<string>()
  if (!o.archive || stateDir === '') return { logged: [], expired }
  const before = await readDone($, list)
  const now = await $.clock.now()
  const next: Done = {}
  const logged: Task[] = []
  for (const t of done) {
    const seen = before[t.id]
    if (seen !== undefined && seen.subject === t.subject) {
      next[t.id] = seen
      if (now - seen.at >= o.keepCompletedHours * HOUR_MS) expired.add(t.id)
      continue
    }
    try {
      await appendLine($, `${stateDir}/${list}.jsonl`, archiveEntry({ list, task: t }))
      next[t.id] = { subject: t.subject, at: now }
      logged.push(t)
      if (o.keepCompletedHours === 0) expired.add(t.id)
    } catch {
      // logged on the next sweep
    }
  }
  if (logged.length > 0 || Object.keys(before).length !== Object.keys(next).length) {
    try {
      await $.fs.write(`${stateDir}/${list}.done.json`, JSON.stringify(next))
    } catch {
      // the next sweep logs these again
    }
  }
  if (logged.length > 0) await act($, 'archived', { list, count: logged.length })
  return { logged, expired }
}

// Lists that an earlier version of this mod emptied by deleting files lost their ids: Claude Code
// starts again after the highest file left. The mark goes past every id the archive log names.
async function raiseIdMark($: Api, list: string, dir: string): Promise<void> {
  const top = await loggedTop($, list)
  const mark = await idMark($, dir)
  if (top <= mark) return
  await $.fs.write(`${dir}/.highwatermark`, String(top))
  await act($, 'id-mark', { list, mark: top })
}

async function idMark($: Api, dir: string): Promise<number> {
  try {
    return Number.parseInt((await $.fs.read(`${dir}/.highwatermark`)).trim(), 10) || 0
  } catch {
    return 0
  }
}

// The highest id the archive log names for the list.
async function loggedTop($: Api, list: string): Promise<number> {
  if (stateDir === '') return 0
  let log = ''
  try {
    log = await $.fs.read(`${stateDir}/${list}.jsonl`)
  } catch {
    return 0
  }
  let top = 0
  for (const line of log.split('\n')) {
    try {
      const e: unknown = JSON.parse(line)
      const id = typeof e === 'object' && e !== null && Reflect.get(e, 'list') === list ? Number(Reflect.get(e, 'id')) : NaN
      if (Number.isSafeInteger(id) && id > top) top = id
    } catch {
      // not a line of the log
    }
  }
  return top
}

// The highest id the list has handed out, as far as the files, the mark and the log tell.
async function listTop($: Api): Promise<number> {
  const l = await currentList($)
  if (l === null) return 0
  const r = await readList($, l.dir)
  const ids = [...r.open, ...r.done].map((t) => Number(t.id)).filter((n) => Number.isSafeInteger(n))
  return Math.max(0, ...ids, await idMark($, l.dir), await loggedTop($, l.id))
}

// The panel of the session that runs now. A session the mod has not followed yet is read back from its
// conversation; when that fails the panel stays unknown and no call is asked for.
async function currentPanel($: Api): Promise<{ session: string; value: Panel } | null> {
  const session = await $.session.id()
  if (panel?.session === session) return panel
  if (stateDir === '') return null
  const saved = await readJson($, `${stateDir}/panel/${session}.json`)
  if (typeof saved === 'object' && saved !== null) {
    panel = { session, value: panelFromRecord(saved) }
    return panel
  }
  try {
    const rows = await $.session.messages()
    const seen = panelFromMessages(rows)
    panel = { session, value: isCompacted(rows) ? withUnknown(seen, await listTop($)) : seen }
  } catch {
    return null
  }
  await savePanel($)
  await act($, 'panel-read', { entries: Object.keys(panel.value).length })
  return panel
}

function panelFromRecord(raw: object): Panel {
  const out: Record<string, { subject: string; status: string }> = {}
  for (const [id, v] of Object.entries(raw)) {
    const subject: unknown = typeof v === 'object' && v !== null ? Reflect.get(v, 'subject') : undefined
    const status: unknown = typeof v === 'object' && v !== null ? Reflect.get(v, 'status') : undefined
    if (typeof subject === 'string' && typeof status === 'string') out[id] = { subject, status }
  }
  return out
}

async function savePanel($: Api): Promise<void> {
  if (panel === null || stateDir === '') return
  try {
    await $.fs.write(`${stateDir}/panel/${panel.session}.json`, JSON.stringify(panel.value))
  } catch {
    // the next change writes it
  }
}

async function changePanel($: Api, fold: (p: Panel) => Panel): Promise<void> {
  const p = await currentPanel($)
  if (p === null) return
  p.value = fold(p.value)
  await savePanel($)
}

type Sweep = { list: string; isNamed: boolean; open: Task[]; calls: string | null }

// Reads the list, logs what is completed, and answers the open tasks and the calls the panel needs.
async function sweep($: Api): Promise<Sweep | null> {
  const l = await currentList($)
  if (l === null) return null
  const r = await readList($, l.dir)
  const a = await archive($, l.id, r.done)
  unseen = [...unseen, ...a.logged]
  let calls: string | null = null
  try {
    const p = await currentPanel($)
    if (p !== null) calls = panelNote(panelCalls({ panel: p.value, disk: [...r.open, ...r.done], expired: a.expired }))
  } catch {
    // the next sweep asks
  }
  return { list: l.id, isNamed: l.isNamed, open: r.open, calls }
}

async function noteOpenTasks($: Api, when: 'start' | 'compaction'): Promise<string | null> {
  const s = await sweep($)
  if (s === null) return null
  const parts = [openTasksNote({ list: s.list, open: s.open, when }), s.calls].filter((x) => x !== null)
  return parts.length === 0 ? null : parts.join('\n\n')
}

export function register(on: On, values: PluginOptions) {
  o = options(values)
  if (!o.enabled) return

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    const r = await next(e)
    // HOME, or USERPROFILE on Windows, where HOME is usually unset. One diary file per session, because
    // `$.fs.write` rewrites the whole file and two sessions sharing one would erase each other's lines.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home !== undefined) {
      stateDir = `${home}/.local/state/mods/todo`
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${stateDir}/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    try {
      const l = await currentList($)
      if (l !== null) await raiseIdMark($, l.id, l.dir)
    } catch {
      // the list keeps the mark it has
    }
    try {
      const note = await noteOpenTasks($, 'start')
      if (note !== null) {
        const sent = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: note }] } })
        await act($, 'deny' in sent ? 'start-note-refused' : 'start-note')
      }
    } catch {
      // the first prompt carries the list anyway
    }
    return r
  })

  // Right after a compaction the summary may have dropped a task. The note goes in as the last message
  // of the compacted conversation. A precompute is kept for later, when the list may differ, so it is
  // left alone; the next prompt from the user carries the list then.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!('messages' in r) || r.messages === undefined || e.trigger === 'precompute' || e.agentId !== undefined) return r
    try {
      const note = await noteOpenTasks($, 'compaction')
      if (note === null) return r
      await act($, 'compaction-note')
      return { ...r, messages: [...r.messages, { role: 'user', text: note, toolUses: [] }] }
    } catch {
      return r
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!REQUEST_ORIGINS.has(e.origin.kind)) return next(e)
    let context: string | null = null
    try {
      const s = await sweep($)
      if (s !== null) {
        const parts = [promptContext({ list: s.list, open: s.open, archived: unseen, remind: o.remind && s.isNamed }), s.calls].filter((x) => x !== null)
        context = parts.length === 0 ? null : parts.join('\n')
        unseen = []
      }
    } catch {
      // the prompt goes in without the list
    }
    if (context === null) return next(e)
    await act($, 'prompt-context')
    return next({ ...e, context: [...(e.context ?? []), context] })
  })

  // The panel takes a create once its result names the id. A subagent's calls never reach it.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || 'deny' in r || r.isError === true) return r
    try {
      const id = createdId(r.text)
      if (id !== undefined) await changePanel($, (p) => panelCreate(p, id, e.subject))
    } catch {
      // the panel copy misses one entry, and the next sweep asks for it
    }
    return r
  })

  // The panel takes an update from its input, whatever the tool answers. A task marked completed goes
  // to the archive log at once.
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      try {
        await changePanel($, (p) => panelUpdate(p, e))
      } catch {
        // the next sweep asks for the call again
      }
    }
    if ('deny' in r || taskUpdate(e).status !== 'completed') return r
    try {
      await sweep($)
    } catch {
      // the next sweep archives it
    }
    return r
  })

  // One summary line per session. `/clear`, `/resume` and `/branch` end a session without reloading the mod.
  on('session.end', async ($, e, next) => {
    const t = tally
    tally = newTally()
    unseen = []
    panel = null
    try {
      if (diary !== '') await appendLine($, diary, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
