// The pure part of the panel mod: its options, where the server is, and the text of /panel. Nothing here
// touches `$`, so the tests cover it without stubs.

export type Options = { port: number; model: string; refreshMinutes: number; autostart: boolean }

export const DEFAULTS: Options = { port: 7777, model: 'sonnet', refreshMinutes: 5, autostart: true }

export function options(values: Readonly<Record<string, unknown>>): Options {
  const port = Number(values.port)
  const refresh = Number(values.refreshMinutes)
  const model = values.model
  return {
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

// The shell line that starts the server detached: its own session, its output to the log, so the
// call that starts it returns at once and the server outlives the Claude Code session.
export function startLine(server: string, log: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  return `setsid -f python3 -I ${q(server)} >>${q(log)} 2>&1 </dev/null`
}

export function serverEnv(o: Options, state: string): Record<string, string> {
  return { PANEL_PORT: String(o.port), PANEL_MODEL: o.model, PANEL_REFRESH_MINUTES: String(o.refreshMinutes), PANEL_STATE: state }
}

export type Counts = { needs: number; working: number; total: number }

// What /panel answers: where the page is, how to reach it from another computer, and what it shows now.
export function panelText(o: Options, up: boolean, counts: Counts | null, host: string): string {
  const url = `http://localhost:${o.port}`
  const lines = [
    up ? `panel: ${url}` : `panel: the page server is not running on port ${o.port}.`,
    `From another computer: ssh -N -L ${o.port}:127.0.0.1:${o.port} ${host}, then open ${url}`,
  ]
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
