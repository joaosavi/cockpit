// `/mods [days]` answers, per mod, whether it helps or gets in the way: how often it acted, what it
// did, and what it cost per tool call, read from the session summaries each mod writes to its diary
// under ~/.local/state/mods, plus audit's per-call lines. A short attention list closes the report.
//
// The text reply works in Remote Control. A surface that draws also gets the Mods pane, same content.

import type { Elements, Hook, On, RenderElement } from 'claude-code'
import { aggregate, type DiaryFile, inWindow, parseDays, render, type ReportLine } from './rules.ts'

type Api = Parameters<Hook<'session.start'>>[0]
type Ui = Pick<Elements['terminal'], 'Box' | 'Text'>

const PANE = 'mods'
const HINT = '/mods N for another window · esc closes'
let shown: ReportLine[] = []

// Every diary under `root` whose day falls in the window, one folder per mod.
async function readDiaries($: Api, root: string, today: string, days: number): Promise<DiaryFile[]> {
  let folders
  try {
    folders = await $.fs.list(root)
  } catch {
    return []
  }
  const files: DiaryFile[] = []
  for (const folder of folders) {
    if (folder.kind !== 'dir') continue
    let entries
    try {
      entries = await $.fs.list(`${root}/${folder.name}`)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.kind !== 'file' || !inWindow(entry.name, today, days)) continue
      try {
        files.push({ mod: folder.name, name: entry.name, text: await $.fs.read(`${root}/${folder.name}/${entry.name}`) })
      } catch {
        // a diary removed between the list and the read
      }
    }
  }
  return files
}

function line(ui: Ui, l: ReportLine): RenderElement {
  switch (l.tone) {
    case 'title':
      return ui.Text({ bold: true, wrap: 'truncate', children: [l.text] })
    case 'warn':
      return ui.Text({ color: 'warning', wrap: 'truncate', children: [l.text] })
    case 'dim':
      return ui.Text({ dimColor: true, wrap: 'truncate', children: [l.text] })
    case 'plain':
      return ui.Text({ wrap: 'truncate', children: [l.text] })
    default: {
      const exhaustive: never = l.tone
      return exhaustive
    }
  }
}

// The Mods pane: the same lines as the text reply, colored by tone, then the key hint.
function reportPane(ui: Ui, lines: readonly ReportLine[]): RenderElement {
  return ui.Box({
    flexDirection: 'column',
    children: [...lines.map((l) => line(ui, l)), ui.Box({ marginTop: 1, children: [ui.Text({ dimColor: true, wrap: 'truncate', children: [HINT] })] })],
  })
}

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'mods', description: 'Show what each mod did and what it cost: /mods [days], 7 by default', argumentHint: '[days]', immediate: true })
    } catch {
      // a taken name leaves the mod without the command
    }
    return next(e)
  })

  on('command.run', { command: 'mods' }, async ($, e) => {
    const home = await $.env.get('HOME')
    if (home === undefined) return { text: 'The mod-report mod has no diaries to read, because HOME is not set.' }
    const days = parseDays(e.args)
    const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
    shown = render(aggregate(await readDiaries($, `${home}/.local/state/mods`, today, days)), today, days)
    $.ui.invalidate('ui.render')
    if ((await $.session.surfaces()).length > 0) await $.ui.open({ id: PANE, title: 'Mods', focus: true, closeOnEscape: true })
    return { text: shown.map((l) => l.text).join('\n') }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return reportPane($.ui.resolve(e), shown)
  })
}
