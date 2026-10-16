// The session summary each mod writes to its diary at session.end: how often the mod acted, what it
// did, and what it cost per tool call. The same file sits in every mod, because a plugin cannot import
// from another plugin's folder. The session-summary line is what an audit of the mods reads.

export type Tally = {
  // Tool calls the mod's tool.call hook saw.
  toolCalls: number
  // How many times the mod did each thing, by the event name its diary uses.
  actions: Record<string, number>
  // Wall time the tool.call hook spent outside `next`, summed and the largest single call.
  hookMs: number
  maxHookMs: number
}

export function newTally(): Tally {
  return { toolCalls: 0, actions: {}, hookMs: 0, maxHookMs: 0 }
}

export function countAction(t: Tally, action: string, by = 1): void {
  t.actions[action] = (t.actions[action] ?? 0) + by
}

// One tool call the hook saw, with the time it spent outside `next`.
export function countCall(t: Tally, ownMs: number): void {
  const ms = Math.max(0, ownMs)
  t.toolCalls += 1
  t.hookMs += ms
  if (ms > t.maxHookMs) t.maxHookMs = ms
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10
}

export type Summary = {
  event: 'session-summary'
  session: string
  cwd: string
  toolCalls: number
  actions: Record<string, number>
  hookMs: number
  maxHookMs: number
}

// The diary line's fields, without `at`, which the diary writer adds. `extra` holds a mod's own figures.
export function sessionSummary(t: Tally, sessionId: string, cwd: string, extra: Readonly<Record<string, number>> = {}): Summary & Record<string, unknown> {
  return {
    event: 'session-summary',
    session: sessionId.slice(0, 8),
    cwd,
    toolCalls: t.toolCalls,
    actions: { ...t.actions },
    hookMs: round(t.hookMs),
    maxHookMs: round(t.maxHookMs),
    ...extra,
  }
}
