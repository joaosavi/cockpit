// Loads the right skill at the right time, in place of the "load skill X before" rules in CLAUDE.md.
//
// Reading a file that calls for a skill: the mod delivers the skill along with the read, and it arrives
// before the edit, because Edit requires reading the file first. Writing without a prior read (new
// file, commit, PR): the mod refuses the call once, with the skill in the refusal text, so the agent
// redoes it following the skill. An error pasted in the prompt: the mod reminds the agent to load
// diagnosing-bugs.

import type { Hook, On } from 'claude-code'
import { asSkill, BUG_REMINDER, byCommand, byTool, looksLikeError, READ_TOOLS, refusalText, WRITE_TOOLS } from './rules.ts'

type Api = Parameters<Hook<'session.start'>>[0]

// The skills already loaded in this conversation, by the mod or by the agent itself.
const loaded = new Set<string>()
// The ones the mod itself delivered, whose text is already in the conversation.
const delivered = new Set<string>()
// The ones that do not exist on this machine. The mod does not look for them again.
const missing = new Set<string>()
let diary = ''

const AUTOMATIC_ORIGINS = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'plugin'])

async function log($: Api, entry: Record<string, unknown>) {
  if (diary === '') return
  let before = ''
  try {
    before = await $.fs.read(diary)
  } catch {
    // first entry of the session
  }
  const line = JSON.stringify({ at: new Date(await $.clock.now()).toISOString(), ...entry })
  await $.fs.write(diary, before + line + '\n')
}

// Reads SKILL.md straight from disk. The Skill tool called by a mod answers "Launching skill" but
// does not put the skill's text in the conversation, so the mod delivers the text itself.
async function skillText($: Api, skill: string): Promise<string | null> {
  const dirs = [`${await $.session.cwd()}/.claude/skills`, `${(await $.env.get('HOME')) ?? ''}/.claude/skills`]
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

async function load($: Api, skill: string, reason: string): Promise<string | null> {
  if (loaded.has(skill) || missing.has(skill)) return null
  const text = await skillText($, skill)
  if (text === null) missing.add(skill)
  else {
    loaded.add(skill)
    delivered.add(skill)
  }
  await log($, { event: text === null ? 'not-found' : 'loaded', skill, reason })
  return text === null ? null : `The skill ${skill} comes in full below, already loaded by the skill-loader mod.\n\n${text}`
}

function pathOf(e: { tool: string }): string {
  const v: unknown = Reflect.get(e, e.tool === 'NotebookEdit' ? 'notebook_path' : 'file_path')
  return typeof v === 'string' ? v : ''
}

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    if (home !== undefined) {
      const dir = `${home}/.local/state/mods/skill-loader`
      await $.process.run(['mkdir', '-p', dir])
      const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
      diary = `${dir}/${day}-${(await $.session.id()).slice(0, 8)}.jsonl`
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent has its own context, and a skill loaded here would go to the main conversation.
    if (e.agentId !== undefined) return next(e)

    // The agent loaded the skill on its own: the mod does not deliver it again. One the mod already
    // delivered does not come again through the tool, because its full text is already in the conversation.
    if (e.tool === 'Skill') {
      const requested: unknown = Reflect.get(e, 'skill')
      if (typeof requested === 'string' && delivered.has(requested)) {
        return { deny: `The skill ${requested} already came in full from the skill-loader mod, earlier in this conversation. Follow it directly.` }
      }
      const r = await next(e)
      const name: unknown = Reflect.get(e, 'skill')
      if (typeof name === 'string' && !('deny' in r) && r.isError !== true) loaded.add(name)
      return r
    }

    if (e.tool === 'Bash') {
      const command: unknown = Reflect.get(e, 'command')
      const t = typeof command === 'string' ? byCommand(command) : null
      if (t === null || loaded.has(t.skill)) return next(e)
      const text = await load($, t.skill, 'command')
      if (text === null) return next(e)
      return { deny: refusalText(t.skill, 'commit messages and PR descriptions', text) }
    }

    const path = pathOf(e)
    const t = byTool(e.tool, path)
    if (t === null || loaded.has(t.skill)) return next(e)

    if (READ_TOOLS.has(e.tool)) {
      const r = await next(e)
      if ('deny' in r || r.isError === true) return r
      const text = await load($, t.skill, `read of ${path}`)
      return text === null ? r : { ...r, context: [...(r.context ?? []), text] }
    }
    if (WRITE_TOOLS.has(e.tool)) {
      const text = await load($, t.skill, `write to ${path}`)
      if (text === null) return next(e)
      return { deny: refusalText(t.skill, path, text) }
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (AUTOMATIC_ORIGINS.has(e.origin.kind) || loaded.has('diagnosing-bugs') || !looksLikeError(e.text)) return next(e)
    await log($, { event: 'reminded-diagnosing-bugs' })
    return next({ ...e, context: [...(e.context ?? []), BUG_REMINDER] })
  })

  // Compaction summarizes the conversation, and a skill loaded earlier may drop out with it.
  on('session.compact', async ($, e, next) => {
    loaded.clear()
    delivered.clear()
    return next(e)
  })

  // `/clear`, `/resume` and `/branch` switch the conversation without reloading the mod.
  on('session.end', async ($, e, next) => {
    loaded.clear()
    delivered.clear()
    missing.clear()
    return next(e)
  })
}
