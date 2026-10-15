import { expect, test } from 'claude-code/testing'
import { countsOf, DEFAULTS, installPathOf, options, panelText, serverEnv, startLine } from '../hooks/rules.ts'

test('options keep valid values and fall back to the defaults', () => {
  expect(options({})).toEqual(DEFAULTS)
  expect(options({ port: 8080, model: 'haiku', refreshMinutes: 10, autostart: false })).toEqual({ port: 8080, model: 'haiku', refreshMinutes: 10, autostart: false })
  expect(options({ port: 80, model: 'x; rm -rf /', refreshMinutes: 0 })).toEqual(DEFAULTS)
})

test('the install record gives the plugin folder', () => {
  const json = JSON.stringify({ plugins: { 'panel@cockpit': [{ installPath: '/c/panel/1.0.0' }], 'hud@cockpit': [{ installPath: '/c/hud' }] } })
  expect(installPathOf(json, 'panel')).toBe('/c/panel/1.0.0')
  expect(installPathOf(json, 'wtf')).toBeNull()
  expect(installPathOf('not json', 'panel')).toBeNull()
})

test('the server starts detached, with its output in the log and the paths quoted', () => {
  expect(startLine("/p/it's/panel.py", '/s/server.log')).toBe(`setsid -f python3 -I '/p/it'\\''s/panel.py' >>'/s/server.log' 2>&1 </dev/null`)
  expect(serverEnv(DEFAULTS, '/s')).toEqual({ PANEL_PORT: '7777', PANEL_MODEL: 'sonnet', PANEL_REFRESH_MINUTES: '5', PANEL_STATE: '/s' })
})

test('/panel counts the live sessions that need the user and the busy ones', () => {
  const json = JSON.stringify({
    sessions: [
      { status: 'idle', summary: { state: 'waiting' } },
      { status: 'idle', summary: { state: 'blocked' } },
      { status: 'busy', summary: { state: 'waiting' } },
      { status: 'idle', summary: null },
      { status: 'ended', summary: { state: 'waiting' } },
    ],
  })
  expect(countsOf(json)).toEqual({ needs: 2, working: 1, total: 4 })
  expect(countsOf('{')).toBeNull()
})

test('/panel names the page and the tunnel', () => {
  expect(panelText(DEFAULTS, true, { needs: 1, working: 2, total: 4 }, 'box')).toBe(
    'panel: http://localhost:7777\nFrom another computer: ssh -N -L 7777:127.0.0.1:7777 box, then open http://localhost:7777\n4 sessions: 1 need you, 2 working.',
  )
  expect(panelText(DEFAULTS, false, null, 'box')).toContain('not running on port 7777')
})
