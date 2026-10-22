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

export type Task = {
  id: string
  subject: string
  description: string
  status: Status
  // `metadata.priority` and `metadata.state` of the task file, when set.
  priority?: string
  state?: string
}

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
  const task: Task = { id, subject, status, description: typeof description === 'string' ? description : '' }
  const metadata: unknown = Reflect.get(raw, 'metadata')
  if (typeof metadata === 'object' && metadata !== null) {
    const priority: unknown = Reflect.get(metadata, 'priority')
    const state: unknown = Reflect.get(metadata, 'state')
    if (typeof priority === 'string' && priority.trim() !== '') task.priority = priority.trim()
    if (typeof state === 'string' && state.trim() !== '') task.state = state.trim()
  }
  return task
}

// Numeric ids in numeric order, the order Claude Code gives them.
export function byId(a: Task, b: Task): number {
  return Number(a.id) - Number(b.id) || a.id.localeCompare(b.id)
}

// A subject such as `[owner] P1 waiting: what was asked` carries the priority and the state when the
// task file has no metadata. The state word is the one before the colon, so `[a] P0 fix login` has a
// priority and no state.
const SUBJECT_TAGS = /^\s*(?:\[[^\]]*\]\s*)?(P\d+)\b(?:\s+([^\s:]+):)?/i

// The priority as a number, P0 first. A task with no priority sorts after every tagged one.
export function rank(t: Task): number {
  const tag = t.priority ?? SUBJECT_TAGS.exec(t.subject)?.[1]
  const n = tag === undefined ? NaN : Number(/^P(\d+)$/i.exec(tag)?.[1])
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}

// The group a task is listed under: its state, or its native status when it names no state.
export function stateOf(t: Task): string {
  return (t.state ?? SUBJECT_TAGS.exec(t.subject)?.[2] ?? t.status).toLowerCase()
}

// Open tasks by priority, then in id order.
export function byPriority(a: Task, b: Task): number {
  return rank(a) - rank(b) || byId(a, b)
}

// One group per state, each sorted by priority. The group holding the most urgent task comes first,
// and on a tie the group of a task in progress, so the work under way reads before the queue.
export function groups(open: readonly Task[]): { state: string; tasks: Task[] }[] {
  const by = new Map<string, Task[]>()
  for (const t of [...open].sort(byPriority)) {
    const k = stateOf(t)
    by.set(k, [...(by.get(k) ?? []), t])
  }
  const top = (ts: readonly Task[]) => ts[0] as Task
  const working = (ts: readonly Task[]) => (ts.some((t) => t.status === 'in_progress') ? 0 : 1)
  return [...by.entries()]
    .map(([state, tasks]) => ({ state, tasks }))
    .sort((a, b) => rank(top(a.tasks)) - rank(top(b.tasks)) || working(a.tasks) - working(b.tasks) || byPriority(top(a.tasks), top(b.tasks)))
}

function listing(open: readonly Task[]): string[] {
  const shown: string[] = []
  let left = MAX_LISTED
  for (const g of groups(open)) {
    if (left === 0) break
    shown.push(`${g.state} (${g.tasks.length}):`)
    for (const t of g.tasks.slice(0, left)) shown.push(`#${t.id} [${t.status}] ${t.subject}`)
    left -= Math.min(left, g.tasks.length)
  }
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
