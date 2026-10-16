import { expect, test } from 'claude-code/testing'
import { countsOf, DEFAULTS, inboxMessage, installPathOf, options, panelText, PYTHONS, serverEnv, startArgs } from '../hooks/rules.ts'

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

test('the server starts itself detached, with no shell, trying each Python name', () => {
  expect(startArgs('python3', "/p/it's/panel.py", '/s/server.log')).toEqual(['python3', '-I', "/p/it's/panel.py", '--detach', '/s/server.log'])
  expect([...PYTHONS]).toEqual(['python3', 'python', 'py'])
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

test('/panel names the page, and the tunnel only over SSH', () => {
  expect(panelText(DEFAULTS, true, { needs: 1, working: 2, total: 4 }, null)).toBe('panel: http://localhost:7777\n4 sessions: 1 need you, 2 working.')
  expect(panelText(DEFAULTS, true, null, 'box')).toBe(
    'panel: http://localhost:7777\nFrom your computer: ssh -N -L 7777:127.0.0.1:7777 box, then open http://localhost:7777',
  )
})

test('an inbox message needs an id and some text', () => {
  expect(inboxMessage('{"id":"a1","text":"Round the total"}')).toEqual({ id: 'a1', text: 'Round the total' })
  expect(inboxMessage('{"id":"a1","text":"  "}')).toBeNull()
  expect(inboxMessage('{"text":"no id"}')).toBeNull()
  expect(inboxMessage('{')).toBeNull()
})
