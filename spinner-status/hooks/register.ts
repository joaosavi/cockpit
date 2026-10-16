// The spinner-status mod replaces the tip line under the spinner with one short line of its own: where the session
// stands, written by a cheap model, or a tip about the user's mods.
//
// Each main-loop turn starts at most one model call, in the background, from `turn.start`. The model
// reads a short excerpt (the last few prompts and the agent's last text, 3,000 characters at most),
// never the whole session. The render hook never waits for it: it shows the previous line, or a tip
// from the catalog, until the new reply arrives and redraws the spinner.
//
// Claude Code's own tip line stays on unless the `spinnerTipsEnabled: false` setting turns it off; the
// README says so. The diary keeps one summary line per session: the model calls by outcome, their
// tokens and their time, never the excerpt or the line.

import type { Hook, On, PluginOptions, Timer } from 'claude-code'
import {
  addUsage,
  drawn,
  kindFor,
  label,
  PREFIX,
  excerpt,
  type Lines,
  lineFor,
  MAX_TOKENS,
  NO_USAGE,
  type Options,
  options,
  type Outcome,
  parseLines,
  prompt,
  SWAP_MS,
  system,
  TIMEOUT_MS,
  type Usage,
  usage,
} from './rules.ts'
import { countAction, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let opts: Options = options(undefined)
let diary = ''
let cwd = ''
// The latest model reply, kept across turns so a new turn shows it until the next one arrives.
let lines: Lines | null = null
// Main-loop turns since the mod loaded: picks the rotation tip.
let turns = 0
// Swaps between the summary and the tip within the running turn.
let phase = 0
let swapTimer: Timer | null = null
let inFlight = false
let tally = newTally()
let spent: Usage = NO_USAGE
let modelMs = 0
let excerptChars = 0

// One diary line. Every mod's diary line starts with `at`, `session` and `event`.
// Claude Code's `language` setting, or '' when unset or unreadable.
async function languageOf($: Api): Promise<string> {
  try {
    const { language } = await $.settings.read()
    return typeof language === 'string' ? language : ''
  } catch {
    return ''
  }
}

async function log($: Api, entry: Record<string, unknown>) {
  if (diary === '') return
  let before = ''
  try {
    before = await $.fs.read(diary)
  } catch {
    // the diary's first line
  }
  const at = new Date(await $.clock.now()).toISOString()
  const session = (await $.session.id()).slice(0, 8)
  await $.fs.write(diary, before + JSON.stringify({ at, session, ...entry }) + '\n')
}

// One model call for the turn that just started. Every path counts its outcome; none throws.
async function refresh($: Api, current: string): Promise<void> {
  if (inFlight) {
    countAction(tally, 'skipped:busy')
    return
  }
  const mode = opts.mode
  if (mode === 'tips') return
  inFlight = true
  const started = await $.clock.now()
  let outcome: Outcome = 'error'
  let used: Usage | null = null
  try {
    const ex = excerpt(await $.session.messages(), current)
    excerptChars += ex.length
    if (ex === '') {
      outcome = 'no-text'
    } else {
      const r = await $.model.complete({ model: opts.model, system: system(mode, await languageOf($)), prompt: prompt(ex), maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS })
      used = usage(r.usage)
      if (r.isAnswered) {
        const got = parseLines(r.text)
        if (got.now === '' && got.tip === '') {
          outcome = 'no-text'
        } else {
          outcome = 'answered'
          lines = got
          phase = 0
          $.ui.invalidate('ui.render')
        }
      } else {
        outcome = r.reason
      }
    }
  } catch {
    outcome = 'error'
  } finally {
    inFlight = false
  }
  countAction(tally, `haiku:${outcome}`)
  spent = addUsage(spent, used)
  modelMs += (await $.clock.now()) - started
}

function stopSwapping() {
  swapTimer?.cancel()
  swapTimer = null
}

export function register(on: On, values: PluginOptions) {
  opts = options(values)
  if (!opts.enabled) return

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/spinner-status/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  // The model call runs on a zero-delay timer, so the turn and the spinner never wait for it.
  on('turn.start', async ($, e, next) => {
    turns += 1
    phase = 0
    countAction(tally, 'turns')
    const current = e.text
    $.clock.after(0, async () => {
      await refresh($, current)
    })
    if (opts.mode === 'mixed') {
      stopSwapping()
      swapTimer = $.clock.every(SWAP_MS, () => {
        phase += 1
        $.ui.invalidate('ui.render')
      })
    }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    stopSwapping()
    return next(e)
  })

  // Claude Code's spinner stays as it is; the line goes under it, dim, in a column.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const line = lineFor({ mode: opts.mode, lines, turn: turns, phase })
    if (line === '') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    const tag = label(kindFor({ mode: opts.mode, lines, phase }))
    const row = Box({
      flexDirection: 'row',
      children: [
        Text({ dimColor: true, children: [PREFIX] }),
        Text({ bold: true, children: [tag] }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [` ${drawn(line, tag, e.viewport?.columns)}`] }),
      ],
    })
    return Box({ flexDirection: 'column', children: [theirs, row] })
  })

  // One summary line per session. `/clear` and `/resume` end a session without reloading the mod,
  // so the counters reset here and not at load.
  on('session.end', async ($, e, next) => {
    stopSwapping()
    const counted = tally
    const u = spent
    const ms = modelMs
    const chars = excerptChars
    tally = newTally()
    spent = NO_USAGE
    modelMs = 0
    excerptChars = 0
    const calls = Object.entries(counted.actions).reduce((sum, [k, n]) => (k.startsWith('haiku:') ? sum + n : sum), 0)
    try {
      await log(
        $,
        sessionSummary(counted, e.sessionId, cwd, {
          calls,
          modelMs: Math.round(ms),
          excerptChars: chars,
          inputTokens: u.input,
          outputTokens: u.output,
          cacheReadTokens: u.cacheRead,
          cacheCreationTokens: u.cacheCreation,
        }),
      )
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
