// Records every MCP call that writes (Slack, Gmail, HubSpot, Notion, Calendar, Drive...) in one file
// per day, without refusing anything. `/audit` shows the last ones.
//
// All sessions share the day's file. The mod appends with `cat >>`, which the kernel writes in one
// piece for a line under 4 KiB, so two sessions writing at once do not erase each other's lines.
//
// At the end of each session, one summary line goes to the same day file: the MCP calls the mod saw,
// how many it recorded, and the time its tool.call hook spent outside `next`. `/audit` skips it,
// because it has no `action`.

import type { Elements, Hook, On, PluginOptions, RenderElement } from 'claude-code'
import {
  argsText,
  cut,
  DEFAULTS,
  emptyText,
  type Entry,
  entryTitle,
  expired,
  fileName,
  headerText,
  isWrite,
  line,
  matching,
  mcpTool,
  type Options,
  options,
  outcomeText,
  parse,
  report,
  request,
  summarize,
} from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]
type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const PANE = 'audit'
// How many more entries the More button adds.
const MORE = 20

// What the /audit pane draws, filled by the command and the buttons; the render hook only reads it.
type View = { entries: Entry[]; count: number; filter: string }
let view: View = { entries: [], count: 0, filter: '' }

let o: Options = DEFAULTS
let folder = ''
let cwd = ''
let tally = newTally()

async function today($: Api): Promise<string> {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

async function append($: Api, entry: Entry) {
  if (folder === '') return
  const file = `${folder}/${fileName(entry.at.slice(0, 10))}`
  await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', file], { stdin: line(entry) + '\n' })
}

// The session summary, appended to the day file like an entry.
async function appendSummary($: Api, fields: Record<string, unknown>) {
  if (folder === '') return
  const at = new Date(await $.clock.now()).toISOString()
  const file = `${folder}/${fileName(at.slice(0, 10))}`
  await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', file], { stdin: JSON.stringify({ at, ...fields }) + '\n' })
}

// Runs the tool.call hook's body and adds its own wall time, outside `next`, to the session tally.
async function timed<I, R>($: Api, next: (input: I) => Promise<R>, body: (pass: (input: I) => Promise<R>) => Promise<R>): Promise<R> {
  const started = await $.clock.now()
  let inside = 0
  const pass = async (input: I): Promise<R> => {
    const at = await $.clock.now()
    try {
      return await next(input)
    } finally {
      inside += (await $.clock.now()) - at
    }
  }
  try {
    return await body(pass)
  } finally {
    countCall(tally, (await $.clock.now()) - started - inside)
  }
}

// Removes the audit files older than the retention.
async function prune($: Api) {
  const names = (await $.fs.list(folder)).map((f) => f.name)
  for (const name of expired(names, await today($), o.retentionDays)) {
    await $.process.run(['rm', '-f', `${folder}/${name}`])
  }
}

// Reads the newest files until there are enough entries for /audit.
async function recent($: Api, wanted: number): Promise<Entry[]> {
  const names = (await $.fs.list(folder)).map((f) => f.name).filter((n) => n.endsWith('.jsonl')).sort().reverse()
  let entries: Entry[] = []
  for (const name of names) {
    try {
      entries = [...parse(await $.fs.read(`${folder}/${name}`)), ...entries]
    } catch {
      // a file removed between the list and the read
    }
    if (entries.length >= wanted) break
  }
  return entries
}

// Reads the entries for the pane, and returns all of them so /audit can write its text from the same read.
async function loadView($: Api, count: number, filter: string): Promise<Entry[]> {
  // A filter can skip most entries, so read more than the count before filtering.
  const entries = await recent($, count * 5)
  view = { entries: matching(entries, filter).slice(-count), count, filter }
  $.ui.invalidate('ui.render')
  return entries
}

const OUTCOME_COLOR = { ok: 'success', error: 'error', denied: 'warning' } as const

// One entry: time · server · action and the colored outcome, then the arguments, dim, cut to the pane.
function entryRows(ui: Ui, e: Entry, columns: number): RenderElement {
  return ui.Box({
    flexDirection: 'column',
    children: [
      ui.Box({
        flexDirection: 'row',
        children: [
          ui.Text({ wrap: 'truncate', children: [`${entryTitle(e, o.timeZone)} · `] }),
          ui.Text({ color: OUTCOME_COLOR[e.outcome], wrap: 'truncate', children: [outcomeText(e, 60)] }),
        ],
      }),
      ui.Text({ dimColor: true, children: [`  ${cut(argsText(e.input), columns - 2)}`] }),
    ],
  })
}

// The /audit pane: a bold header, the entries newest first, then the key hints.
function auditPane(ui: Ui, v: View, columns: number, more: () => Promise<void>, refresh: () => Promise<void>): RenderElement {
  const n = v.entries.length
  const header = n === 0 ? emptyText(v.filter) : headerText(n, v.filter)
  // Newest first, so the latest calls show without scrolling.
  const rows = [...v.entries].reverse().map((e) => entryRows(ui, e, columns))
  return ui.Box({
    flexDirection: 'column',
    children: [
      ui.Text({ bold: true, wrap: 'truncate', children: [header] }),
      ...rows,
      ui.Box({
        flexDirection: 'row',
        columnGap: 3,
        marginTop: 1,
        children: [
          ui.Button({ key: 'more', label: 'More', hotkey: 'm', plain: true, onPress: more }),
          ui.Button({ key: 'refresh', label: 'Refresh', hotkey: 'r', plain: true, onPress: refresh }),
          ui.Text({ dimColor: true, wrap: 'truncate', children: ['esc closes'] }),
        ],
      }),
    ],
  })
}

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    cwd = await $.session.cwd()
    if (home !== undefined) {
      folder = `${home}/.local/state/mods/audit`
      await $.process.run(['mkdir', '-p', folder])
      try {
        await prune($)
      } catch {
        // the folder may not be listable yet
      }
    }
    try {
      await $.command.register({ name: 'audit', description: 'Show the last MCP calls that wrote: /audit [count] [filter]', argumentHint: '[count] [filter]', immediate: true })
    } catch {
      // a taken name leaves the mod recording without the command
    }
    return next(e)
  })

  // The text reply stays for Remote Control, which draws no pane.
  on('command.run', { command: 'audit' }, async ($, e) => {
    if (folder === '') return { text: 'The audit mod has no folder to read, because HOME is not set.' }
    const { count, filter } = request(e.args, o)
    const text = report(await loadView($, count, filter), e.args, o)
    if ((await $.session.surfaces()).length > 0) await $.ui.open({ id: PANE, title: 'Audit', focus: true, closeOnEscape: true })
    return { text }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return auditPane(
      $.ui.resolve(e),
      view,
      e.props.bodyColumns,
      async () => {
        await loadView($, view.count + MORE, view.filter)
      },
      async () => {
        await loadView($, view.count, view.filter)
      },
    )
  })

  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) =>
    timed($, next, async (pass) => {
      const t = mcpTool(e.tool)
      if (t === null || !isWrite(t.action)) return pass(e)
      const start = await $.clock.now()
      const r = await pass(e)
      const outcome: Entry['outcome'] = 'deny' in r ? 'denied' : r.isError === true ? 'error' : 'ok'
      const error = 'deny' in r ? r.deny : r.isError === true ? r.text : undefined
      countAction(tally, 'recorded')
      await append($, {
        at: new Date(start).toISOString(),
        event: 'write-call',
        // Read on each call, because `/clear` and `/resume` change the session id without reloading the mod.
        session: (await $.session.id()).slice(0, 8),
        cwd,
        ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
        server: t.server,
        action: t.action,
        input: summarize(e),
        outcome,
        ...(error === undefined ? {} : { error: error.slice(0, 500) }),
        ms: Math.round((await $.clock.now()) - start),
      })
      return r
    }),
  )

  // One summary line per session. `/clear`, `/resume` and `/branch` end a session without reloading the mod.
  on('session.end', async ($, e, next) => {
    const t = tally
    tally = newTally()
    try {
      await appendSummary($, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
