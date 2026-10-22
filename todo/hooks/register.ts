// Keeps Claude Code's native task list in front of the agent. The list lives on disk, so it outlives
// a compaction, but the model forgets it is there: this mod shows the open tasks when the session
// starts and right after each compaction, reminds the agent on each prompt from the user that a new
// request becomes a task first, and moves completed tasks to an archive log so the list holds only
// open work.
//
// The list is read from the files Claude Code writes, never from the model, so a task a script wrote
// straight into the folder shows up too.
//
// The diary records each action, and at the end of the session one summary line with the counts.

import type { Hook, On, PluginOptions } from 'claude-code'
import {
  archiveEntry,
  byId,
  cleanListId,
  DEFAULTS,
  openTasksNote,
  type Options,
  options,
  parseTask,
  promptContext,
  REQUEST_ORIGINS,
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

const RM_TIMEOUT_MS = 5000

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

type Read = { open: Task[]; done: { task: Task; path: string }[] }

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
    if (task.status === 'completed') out.done.push({ task, path })
    else out.open.push(task)
  }
  out.open.sort(byId)
  return out
}

// Deletes files with `rm`, or with `del` on Windows, where `rm` is missing unless Git's tools are on
// the PATH. `$.fs` writes but does not delete.
async function removeFiles($: Api, paths: readonly string[]): Promise<void> {
  try {
    await $.process.run(['rm', '-f', ...paths], { timeoutMs: RM_TIMEOUT_MS })
    return
  } catch {
    // no `rm`: Windows
  }
  try {
    await $.process.run(['cmd', '/d', '/c', 'del', '/f', '/q', ...paths.map((p) => p.replaceAll('/', '\\'))], { timeoutMs: RM_TIMEOUT_MS })
  } catch {
    // neither: the next sweep tries again
  }
}

// Completed tasks go to the archive log first and leave the list after, so a failed write keeps the task.
async function archive($: Api, list: string, done: Read['done']): Promise<Task[]> {
  if (!o.archive || done.length === 0 || stateDir === '') return []
  const moved: string[] = []
  const tasks: Task[] = []
  for (const d of done) {
    try {
      await appendLine($, `${stateDir}/${list}.jsonl`, archiveEntry({ list, task: d.task }))
      moved.push(d.path)
      tasks.push(d.task)
    } catch {
      // stays in the list until the next sweep
    }
  }
  if (moved.length === 0) return []
  await removeFiles($, moved)
  await act($, 'archived', { list, count: moved.length })
  return tasks
}

// Reads the list, archives what is completed, and answers the open tasks.
async function sweep($: Api): Promise<{ list: string; isNamed: boolean; open: Task[] } | null> {
  const l = await currentList($)
  if (l === null) return null
  const r = await readList($, l.dir)
  unseen = [...unseen, ...(await archive($, l.id, r.done))]
  return { list: l.id, isNamed: l.isNamed, open: r.open }
}

async function noteOpenTasks($: Api, when: 'start' | 'compaction'): Promise<string | null> {
  const s = await sweep($)
  if (s === null) return null
  return openTasksNote({ list: s.list, open: s.open, when })
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
        context = promptContext({ list: s.list, open: s.open, archived: unseen, remind: o.remind && s.isNamed })
        unseen = []
      }
    } catch {
      // the prompt goes in without the list
    }
    if (context === null) return next(e)
    await act($, 'prompt-context')
    return next({ ...e, context: [...(e.context ?? []), context] })
  })

  // A task marked completed leaves the list at once.
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
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
    try {
      if (diary !== '') await appendLine($, diary, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
