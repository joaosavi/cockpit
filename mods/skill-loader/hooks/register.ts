// Loads the right skill at the right time, in place of the "load skill X before" rules in CLAUDE.md.
//
// Reading a file that calls for a skill: the mod delivers the skill along with the read, and it arrives
// before the edit, because Edit requires reading the file first. Writing without a prior read (new
// file, commit, PR): the mod refuses the call once, with the skill in the refusal text, so the agent
// redoes it following the skill. An error pasted in the prompt: the mod reminds the agent to load
// diagnosing-bugs.
//
// At the end of each session, one summary line in the diary counts the tool calls the mod saw, the
// skills it loaded by name, the calls it refused so the agent would redo them with the skill, and the
// time its tool.call hook spent outside `next`.

import type { Hook, On } from 'claude-code'
import { alreadyDeliveredText, asSkill, bareSkill, installPathOf, BUG_REMINDER, byCommand, byTool, loadedText, looksLikeError, READ_TOOLS, refusalText, WRITE_TOOLS } from './rules.ts'
import { countAction, countCall, newTally, sessionSummary } from './summary.ts'

type Api = Parameters<Hook<'session.start'>>[0]

// The skills already loaded in this conversation, by the mod or by the agent itself.
const loaded = new Set<string>()
// The ones the mod itself delivered, whose text is already in the conversation.
const delivered = new Set<string>()
// The ones that do not exist on this machine. The mod does not look for them again.
const missing = new Set<string>()
let diary = ''
let cwd = ''
let tally = newTally()

const AUTOMATIC_ORIGINS = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'plugin'])

// One diary line. Every mod's diary line starts with `at`, `session` and `event`. The session id is read
// on each write, because `/clear` and `/resume` change it without reloading the mod.
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

// The `skills` folder this plugin ships, found through the install record Claude Code keeps. Read
// once per load of the mod; '' when the record names no install, as under --plugin-dir.
let ownSkills: string | null = null

async function ownSkillsDir($: Api): Promise<string> {
  if (ownSkills !== null) return ownSkills
  ownSkills = ''
  try {
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const path = installPathOf(await $.fs.read(`${config}/plugins/installed_plugins.json`), 'skill-loader')
    if (path !== null) ownSkills = `${path}/skills`
  } catch {
    // no install record: only the user's and the project's skills
  }
  return ownSkills
}

// Reads SKILL.md straight from disk. The Skill tool called by a mod answers "Launching skill" but
// does not put the skill's text in the conversation, so the mod delivers the text itself. The
// plugin's own copy comes first; the project's and the user's folders cover a skill it lacks.
async function skillText($: Api, skill: string): Promise<string | null> {
  const own = await ownSkillsDir($)
  const dirs = [...(own === '' ? [] : [own]), `${await $.session.cwd()}/.claude/skills`, `${(await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''}/.claude/skills`]
  for (const base of dirs) {
    const dir = `${base}/${skill}`
    try {
      return asSkill(dir, await $.fs.read(`${dir}/SKILL.md`))
    } catch {
      // try the next directory
    }
  }
  return null
}

// The skill's text the first time a call needs it in this conversation; null when it is already
// loaded or does not exist on this machine.
async function load($: Api, skill: string, reason: string): Promise<string | null> {
  if (loaded.has(skill) || missing.has(skill)) return null
  const text = await skillText($, skill)
  if (text === null) {
    missing.add(skill)
    countAction(tally, 'not-found')
  } else {
    loaded.add(skill)
    delivered.add(skill)
    countAction(tally, `loaded:${skill}`)
  }
  await log($, { event: text === null ? 'not-found' : 'loaded', skill, reason })
  return text
}

function pathOf(e: { tool: string }): string {
  const v: unknown = Reflect.get(e, e.tool === 'NotebookEdit' ? 'notebook_path' : 'file_path')
  return typeof v === 'string' ? v : ''
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

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // One file per session, because `$.fs.write` rewrites the whole file and two sessions sharing one
    // would erase each other's lines. `$.fs.write` creates the folder with the first line.
    // HOME, or USERPROFILE on Windows, where HOME is usually unset.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home !== undefined) {
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${home}/.local/state/mods/skill-loader/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) =>
    timed($, next, async (pass) => {
      // A subagent has its own context, and a skill loaded here would go to the main conversation.
      if (e.agentId !== undefined) return pass(e)

      // The agent loaded the skill on its own: the mod does not deliver it again. One the mod already
      // delivered does not come again through the tool, because its full text is already in the conversation.
      if (e.tool === 'Skill') {
        const asked: unknown = Reflect.get(e, 'skill')
        if (typeof asked !== 'string') return pass(e)
        const requested = bareSkill(asked)
        if (delivered.has(requested)) {
          countAction(tally, 'already-delivered')
          return { deny: alreadyDeliveredText(requested) }
        }
        const r = await pass(e)
        if (!('deny' in r) && r.isError !== true) loaded.add(requested)
        return r
      }

      if (e.tool === 'Bash') {
        const command: unknown = Reflect.get(e, 'command')
        const t = typeof command === 'string' ? byCommand(command) : null
        if (t === null || loaded.has(t.skill)) return pass(e)
        const text = await load($, t.skill, 'command')
        if (text === null) return pass(e)
        countAction(tally, 'refused')
        await log($, { event: 'refused', skill: t.skill, tool: e.tool })
        return { deny: refusalText(t.skill, 'commit messages and pull request descriptions', text) }
      }

      const path = pathOf(e)
      const t = byTool(e.tool, path)
      if (t === null || loaded.has(t.skill)) return pass(e)

      if (READ_TOOLS.has(e.tool)) {
        const r = await pass(e)
        if ('deny' in r || r.isError === true) return r
        const text = await load($, t.skill, `read of ${path}`)
        return text === null ? r : { ...r, context: [...(r.context ?? []), loadedText(t.skill, text)] }
      }
      if (WRITE_TOOLS.has(e.tool)) {
        const text = await load($, t.skill, `write to ${path}`)
        if (text === null) return pass(e)
        countAction(tally, 'refused')
        await log($, { event: 'refused', skill: t.skill, tool: e.tool })
        return { deny: refusalText(t.skill, path, text) }
      }
      return pass(e)
    }),
  )

  on('prompt.submit', async ($, e, next) => {
    if (AUTOMATIC_ORIGINS.has(e.origin.kind) || loaded.has('diagnosing-bugs') || !looksLikeError(e.text)) return next(e)
    countAction(tally, 'reminded-diagnosing-bugs')
    await log($, { event: 'reminded-diagnosing-bugs' })
    return next({ ...e, context: [...(e.context ?? []), BUG_REMINDER] })
  })

  // Compaction summarizes the conversation, and a skill loaded earlier may drop out with it.
  on('session.compact', async ($, e, next) => {
    loaded.clear()
    delivered.clear()
    return next(e)
  })

  // `/clear`, `/resume` and `/branch` switch the conversation without reloading the mod. One summary line per session.
  on('session.end', async ($, e, next) => {
    loaded.clear()
    delivered.clear()
    missing.clear()
    const t = tally
    tally = newTally()
    try {
      await log($, sessionSummary(t, e.sessionId, cwd))
    } catch {
      // a summary that cannot be written does not hold up the end of the session
    }
    return next(e)
  })
}
