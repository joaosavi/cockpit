// Records every MCP call that writes (Slack, Gmail, HubSpot, Notion, Calendar, Drive...) in one file
// per day, without refusing anything. `/audit` shows the last ones.
//
// All sessions share the day's file. The mod appends with `cat >>`, which the kernel writes in one
// piece for a line under 4 KiB, so two sessions writing at once do not erase each other's lines.

import type { Hook, On, PluginOptions } from 'claude-code'
import { DEFAULTS, type Entry, expired, fileName, isWrite, line, mcpTool, type Options, options, parse, report, request, summarize } from './rules.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = DEFAULTS
let folder = ''
let session = ''
let cwd = ''

async function today($: Api): Promise<string> {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

async function append($: Api, entry: Entry) {
  if (folder === '') return
  const file = `${folder}/${fileName(entry.at.slice(0, 10))}`
  await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', file], { stdin: line(entry) + '\n' })
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

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    session = (await $.session.id()).slice(0, 8)
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
      await $.command.register({ name: 'audit', description: 'Shows the last MCP write calls: /audit [count] [filter]', argumentHint: '[count] [filter]', immediate: true })
    } catch {
      // a taken name leaves the mod recording without the command
    }
    return next(e)
  })

  on('command.run', { command: 'audit' }, async ($, e) => {
    if (folder === '') return { text: 'The audit mod has no folder to read: HOME is not set.' }
    // A filter can skip most entries, so read more than the count before filtering.
    return { text: report(await recent($, request(e.args, o).count * 5), e.args, o) }
  })

  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const t = mcpTool(e.tool)
    if (t === null || !isWrite(t.action)) return next(e)
    const start = await $.clock.now()
    const r = await next(e)
    const outcome: Entry['outcome'] = 'deny' in r ? 'denied' : r.isError === true ? 'error' : 'ok'
    const error = 'deny' in r ? r.deny : r.isError === true ? r.text : undefined
    await append($, {
      at: new Date(start).toISOString(),
      session,
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
  })
}
