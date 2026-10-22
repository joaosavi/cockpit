// The todo mod's rules, with no mods API, so the tests run them directly.
//
// Claude Code keeps the task list on disk: one JSON file per task in
// `<config dir>/tasks/<list>/<id>.json`, where the list is CLAUDE_CODE_TASK_LIST_ID when set and the
// session id otherwise. Both are cleaned the way Claude Code cleans them: anything outside
// [a-zA-Z0-9_-] becomes `-`.

export type Options = {
  // Off, the mod registers no hook.
  enabled: boolean
  // With a named list, each prompt from the user carries the request reminder.
  remind: boolean
  // A completed task leaves the list for the archive log.
  archive: boolean
}

export const DEFAULTS: Options = { enabled: true, remind: true, archive: true }

export function options(values: unknown): Options {
  if (typeof values !== 'object' || values === null) return DEFAULTS
  return {
    enabled: Reflect.get(values, 'enabled') !== false,
    remind: Reflect.get(values, 'remind') !== false,
    archive: Reflect.get(values, 'archive') !== false,
  }
}

export type Status = 'pending' | 'in_progress' | 'completed'

export type Task = { id: string; subject: string; description: string; status: Status }

// More than this many open tasks are cut from the note, with a count of the rest.
export const MAX_LISTED = 30

export function cleanListId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-')
}

// CLAUDE_CODE_ENABLE_TODO_TOOLS as Claude Code reads a boolean variable.
export function isTruthy(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes|on)$/i.test(value.trim())
}

function isStatus(v: unknown): v is Status {
  return v === 'pending' || v === 'in_progress' || v === 'completed'
}

// One task file, or null when the file is not a task: a lock, a partial write, another tool's file.
export function parseTask(text: string): Task | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const id: unknown = Reflect.get(raw, 'id')
  const subject: unknown = Reflect.get(raw, 'subject')
  const status: unknown = Reflect.get(raw, 'status')
  const description: unknown = Reflect.get(raw, 'description')
  if (typeof id !== 'string' || typeof subject !== 'string' || !isStatus(status)) return null
  return { id, subject, status, description: typeof description === 'string' ? description : '' }
}

// Numeric ids in numeric order, the order Claude Code gives them.
export function byId(a: Task, b: Task): number {
  return Number(a.id) - Number(b.id) || a.id.localeCompare(b.id)
}

function listing(open: readonly Task[]): string[] {
  const shown = open.slice(0, MAX_LISTED).map((t) => `#${t.id} [${t.status}] ${t.subject}`)
  if (open.length > MAX_LISTED) shown.push(`... and ${open.length - MAX_LISTED} more: run TaskList.`)
  return shown
}

// The note the model reads at session start and right after a compaction. Null with no open task.
export function openTasksNote(a: { list: string; open: readonly Task[]; when: 'start' | 'compaction' }): string | null {
  if (a.open.length === 0) return null
  const head =
    a.when === 'compaction'
      ? `The conversation was just compacted. The task list "${a.list}" is on disk and still holds these open tasks:`
      : `The task list "${a.list}" holds these open tasks:`
  return [head, ...listing(a.open), 'TaskGet shows a task in full. Keep the list current with TaskUpdate.'].join('\n')
}

export const RULE =
  'A new request from the user becomes a task (TaskCreate) before any other work, with its owner in the ' +
  'subject, such as "[owner] what was asked". Mark it completed only after the result was reported.'

// The context attached to a prompt from the user: the rule, then the open tasks. The list goes in whole
// each time, because a compaction may have dropped the last one and a plugin hears of no compaction on
// some plans (see the README). Null when there is nothing to say.
// Tasks completed since the last prompt, by this session or by a script, come first, so the model
// knows why they left the list.
export function promptContext(a: { list: string; open: readonly Task[]; archived: readonly Task[]; remind: boolean }): string | null {
  const parts: string[] = []
  if (a.remind) parts.push(`Task list "${a.list}". ${RULE}`)
  if (a.archived.length > 0) parts.push(`Completed and archived since the last prompt:\n${a.archived.map((t) => `#${t.id} ${t.subject}`).join('\n')}`)
  if (a.open.length > 0) parts.push(`Open tasks now:\n${listing(a.open).join('\n')}`)
  return parts.length === 0 ? null : parts.join('\n')
}

// Prompts the reminder answers: a person typing in the terminal, the app, or a channel such as
// Telegram, and `claude -p`. Notifications, peers, schedules and continuations are not requests.
export const REQUEST_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'channel', 'sdk'])

// The archive line of a completed task, without `at` and `session`, which the diary writer adds.
export function archiveEntry(a: { list: string; task: Task }): Record<string, string> {
  return { event: 'archived', list: a.list, id: a.task.id, subject: a.task.subject, description: a.task.description }
}

// The task id and status a TaskUpdate call sets; either is undefined when the call leaves it out.
export function taskUpdate(input: unknown): { id: string | undefined; status: string | undefined } {
  if (typeof input !== 'object' || input === null) return { id: undefined, status: undefined }
  const id: unknown = Reflect.get(input, 'taskId')
  const status: unknown = Reflect.get(input, 'status')
  return {
    id: typeof id === 'string' ? id : typeof id === 'number' ? String(id) : undefined,
    status: typeof status === 'string' ? status : undefined,
  }
}
