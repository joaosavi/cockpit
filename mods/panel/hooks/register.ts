// The panel mod keeps the Cockpit panel running: a local web page with a card for every Claude Code
// session on this machine. The page itself is a small Python server in this plugin's `server` folder.
// It reads Claude Code's session files and transcripts, and asks `claude -p` for each card's summary.
//
// The mod does two things. When a session starts and the page server does not answer, it starts it,
// detached, so it outlives the session. And `/panel` says where the page is and how to reach it
// through an SSH tunnel. Nothing reaches the agent.

import type { Hook, On, PluginOptions } from 'claude-code'
import { countsOf, installPathOf, type Options, options, panelText, serverEnv, startLine } from './rules.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = options({})

async function home($: Api): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

async function stateDir($: Api): Promise<string> {
  return `${await home($)}/.local/state/mods/panel`
}

async function get($: Api, path: string): Promise<string | null> {
  try {
    const r = await $.process.run(['curl', '-s', '-m', '2', `http://127.0.0.1:${o.port}${path}`], { timeoutMs: 4000 })
    return r.exitCode === 0 && r.stdout !== '' ? r.stdout : null
  } catch {
    return null
  }
}

async function serverPath($: Api): Promise<string | null> {
  try {
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await home($)}/.claude`
    const root = installPathOf(await $.fs.read(`${config}/plugins/installed_plugins.json`), 'panel')
    return root === null ? null : `${root}/server/panel.py`
  } catch {
    return null
  }
}

// Starts the page server when it does not answer. Every session tries; the port lets one server bind.
async function ensureServer($: Api): Promise<void> {
  if ((await get($, '/api/health')) !== null) return
  const server = await serverPath($)
  if (server === null) return
  const state = await stateDir($)
  await $.process.run(['mkdir', '-p', state])
  await $.process.run(['sh', '-c', startLine(server, `${state}/server.log`)], { env: serverEnv(o, state), timeoutMs: 5000 })
}

export function register(on: On, values: PluginOptions) {
  o = options(values)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'panel', description: 'Where the Cockpit panel is: a web page with every session on this machine', immediate: true })
    } catch {
      // the command is a convenience; the server still starts
    }
    if (o.autostart) {
      $.clock.after(0, async () => {
        try {
          await ensureServer($)
        } catch {
          // the next session tries again
        }
      })
    }
    return next(e)
  })

  on('command.run', { command: 'panel' }, async ($) => {
    if (o.autostart) await ensureServer($)
    const sessions = await get($, '/api/sessions')
    const host = (await $.process.run(['hostname'])).stdout.trim() || 'this-machine'
    return { text: panelText(o, sessions !== null, sessions === null ? null : countsOf(sessions), host) }
  })
}
