// The panel mod keeps the Cockpit panel running: a local web page with a card for every Claude Code
// session on this machine. The page itself is a small Python server in this plugin's `server` folder.
// It reads Claude Code's session files and transcripts, and asks `claude -p` for each card's summary.
//
// The mod does three things. When a session starts and the page server does not answer, it starts it,
// detached, so it outlives the session. Every 2 seconds it checks the session's inbox, where the page
// leaves an answer sent from a card, and submits that answer as the user's prompt. And `/panel` says
// where the page is, with the SSH tunnel when the session runs over SSH.

import type { Hook, On, PluginOptions } from 'claude-code'
import { countsOf, inboxMessage, installPathOf, type Options, options, panelText, PYTHONS, serverEnv, startArgs } from './rules.ts'

type Api = Parameters<Hook<'session.start'>>[0]

let o: Options = options({})

async function home($: Api): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
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
  for (const python of PYTHONS) {
    try {
      const r = await $.process.run(startArgs(python, server, `${state}/server.log`), { env: serverEnv(o, state), timeoutMs: 8000 })
      if (r.exitCode === 0) return
    } catch {
      // this Python is not installed; try the next name
    }
  }
}

// The page writes `<session>.json` with an id and a text. The mod answers through `<session>.seen`, which it
// rewrites on every check: its time tells the page the session listens, and `done` names the last message
// it submitted, so a message is submitted once even after a reload.
async function watchInbox($: Api): Promise<void> {
  const inbox = `${await stateDir($)}/inbox`
  const id = await $.session.id()
  const seen = `${inbox}/${id}.seen`
  let done: string | null = null
  try {
    done = (JSON.parse(await $.fs.read(seen)) as { done?: string }).done ?? null
  } catch {
    // first check of this session
  }
  $.clock.every(2000, async () => {
    try {
      let msg: { id: string; text: string } | null = null
      try {
        msg = inboxMessage(await $.fs.read(`${inbox}/${id}.json`))
      } catch {
        // no message waiting
      }
      if (msg !== null && msg.id !== done) {
        done = msg.id
        await $.fs.write(seen, JSON.stringify({ done }))
        void $.prompt.submit({ text: msg.text, asUser: true })
        return
      }
      await $.fs.write(seen, JSON.stringify({ done }))
    } catch {
      // the folder does not exist until the page server starts
    }
  })
}

export function register(on: On, values: PluginOptions) {
  o = options(values)
  if (!o.enabled) return

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'panel', description: 'Where the Cockpit panel is: a web page with every session on this machine', immediate: true })
    } catch {
      // the command is a convenience; the server still starts
    }
    try {
      if (o.answers) await watchInbox($)
    } catch {
      // without the inbox the page cannot answer this session; everything else works
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
    const overSsh = ((await $.env.get('SSH_CONNECTION')) ?? '') !== ''
    const host = overSsh ? (await $.process.run(['hostname'])).stdout.trim() || 'this-machine' : null
    return { text: panelText(o, sessions !== null, sessions === null ? null : countsOf(sessions), host) }
  })
}
