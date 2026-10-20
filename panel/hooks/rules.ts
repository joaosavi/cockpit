// The pure part of the panel mod: its options, where the server is, and the text of /panel. Nothing here
// touches `$`, so the tests cover it without stubs.

// `enabled` off registers no hook. `answers` off leaves the inbox unread, so the page cannot type into this session.
export type Options = { enabled: boolean; answers: boolean; port: number; model: string; refreshMinutes: number; autostart: boolean }

export const DEFAULTS: Options = { enabled: true, answers: true, port: 7777, model: 'sonnet', refreshMinutes: 5, autostart: true }

export function options(values: Readonly<Record<string, unknown>>): Options {
  const port = Number(values.port)
  const refresh = Number(values.refreshMinutes)
  const model = values.model
  return {
    enabled: values.enabled !== false,
    answers: values.answers !== false,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULTS.port,
    model: typeof model === 'string' && /^[a-z0-9.\-[\]]+$/i.test(model) ? model : DEFAULTS.model,
    refreshMinutes: Number.isFinite(refresh) && refresh >= 1 ? refresh : DEFAULTS.refreshMinutes,
    autostart: values.autostart !== false,
  }
}

// The plugin's install folder from Claude Code's install record, or null when the record names none,
// as under --plugin-dir.
export function installPathOf(json: string, plugin: string): string | null {
  try {
    const plugins: unknown = Reflect.get(JSON.parse(json) as object, 'plugins')
    if (typeof plugins !== 'object' || plugins === null) return null
    for (const [key, entries] of Object.entries(plugins)) {
      if (!key.startsWith(`${plugin}@`) || !Array.isArray(entries)) continue
      for (const entry of entries as unknown[]) {
        const path: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'installPath') : undefined
        if (typeof path === 'string' && path !== '') return path
      }
    }
    return null
  } catch {
    return null
  }
}

// The Python commands to try, in order: `python3` on Linux and macOS, `python` or the `py` launcher on Windows.
export const PYTHONS = ['python3', 'python', 'py'] as const

// The command that starts the server detached. The server starts itself again in the background and exits,
// so no shell is needed and it works the same on Linux, macOS and Windows.
export function startArgs(python: string, server: string, log: string): string[] {
  return [python, '-I', server, '--detach', log]
}

export function serverEnv(o: Options, state: string): Record<string, string> {
  return { PANEL_PORT: String(o.port), PANEL_MODEL: o.model, PANEL_REFRESH_MINUTES: String(o.refreshMinutes), PANEL_STATE: state }
}

export type Counts = { needs: number; working: number; total: number }

// What /panel answers: where the page is and what it shows now. `sshHost` is set when the session runs over
// SSH, and then the answer adds the tunnel that reaches the page from the computer the user sits at.
export function panelText(o: Options, up: boolean, counts: Counts | null, sshHost: string | null): string {
  const url = `http://localhost:${o.port}`
  const lines = [up ? `panel: ${url}` : `panel: the page server is not running on port ${o.port}.`]
  if (sshHost !== null) lines.push(`From your computer: ssh -N -L ${o.port}:127.0.0.1:${o.port} ${sshHost}, then open ${url}`)
  if (up && counts !== null) lines.push(`${counts.total} sessions: ${counts.needs} need you, ${counts.working} working.`)
  return lines.join('\n')
}

// The counts in /panel from the server's /api/sessions answer, or null when it does not parse.
export function countsOf(json: string): Counts | null {
  try {
    const sessions: unknown = Reflect.get(JSON.parse(json) as object, 'sessions')
    if (!Array.isArray(sessions)) return null
    let needs = 0
    let working = 0
    let total = 0
    for (const s of sessions as Record<string, unknown>[]) {
      if (s.status === 'ended') continue
      total += 1
      const state = (s.summary as Record<string, unknown> | null)?.state
      if (s.status === 'busy') working += 1
      else if (state === 'waiting' || state === 'blocked') needs += 1
    }
    return { needs, working, total }
  } catch {
    return null
  }
}

// A message the page left in a session's inbox, or null when the file is not one.
export function inboxMessage(json: string): { id: string; text: string } | null {
  try {
    const m = JSON.parse(json) as { id?: unknown; text?: unknown }
    return typeof m.id === 'string' && typeof m.text === 'string' && m.text.trim() !== '' ? { id: m.id, text: m.text } : null
  } catch {
    return null
  }
}
