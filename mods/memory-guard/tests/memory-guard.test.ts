import { expect, mock, test } from 'claude-code/testing'
import { groups, headroom, heavy, reduced, withMeasurement } from '../hooks/rules.ts'

const MB = 1024 * 1024
const GB = 1024 * MB
const HIGH = 3 * GB
// With the 2% margin, up to 98% of the high mark fits.
const LIMIT = HIGH * 0.98

test('recognizes the heavy runners and ignores what only mentions the name', () => {
  expect(heavy('yarn turbo run typecheck')).toMatchObject({ kind: 'typecheck' })
  expect(heavy('cd apps/web && npx vitest run src')).toMatchObject({ kind: 'test', key: 'npx vitest' })
  expect(heavy('npx tsc --noEmit -p .')).toMatchObject({ kind: 'typecheck' })
  expect(heavy('yarn workspace web build')).toMatchObject({ kind: 'build', key: 'yarn workspace web build' })
  expect(heavy('yarn build')).toMatchObject({ kind: 'build' })
  expect(heavy('npx playwright test e2e')).toMatchObject({ kind: 'playwright' })
  expect(heavy('git commit -m "run tsc and vitest"')).toBeNull()
  expect(heavy('grep vitest package.json')).toBeNull()
  expect(heavy('tsc --version')).toBeNull()
  expect(heavy("cat > a.sh <<'EOF'\nyarn test\nEOF")).toBeNull()
})

test('reduces the parallelism of runners that accept it, and not of tsc', () => {
  const t = 'yarn turbo run test --filter api'
  const h = heavy(t)
  expect(h === null ? null : reduced(t, h)).toBe('yarn turbo run test --concurrency=1 --filter api')
  const u = 'yarn turbo run test:unit --filter api'
  const hu = heavy(u)
  expect(hu === null ? null : reduced(u, hu)).toBe('yarn turbo run test:unit --concurrency=1 --filter api')
  const v = 'npx vitest run'
  const hv = heavy(v)
  expect(hv === null ? null : reduced(v, hv)).toBe('npx vitest --maxWorkers=1 run')
  const c = 'npx tsc --noEmit'
  const hc = heavy(c)
  expect(hc === null ? 'x' : reduced(c, hc)).toBeNull()
})

test('the headroom is that of the tightest group, and without a group the machine applies', () => {
  const levels = [
    { group: '/a/b', used: 1 * GB, high: 3 * GB, max: null },
    { group: '/a', used: 4 * GB, high: 4.5 * GB, max: null },
  ]
  expect(headroom(levels, null, 0)).toBe(0.5 * GB)
  expect(headroom([], { available: 8 * GB, total: 16 * GB }, 2)).toBe(8 * GB - 16 * GB * 0.02)
  expect(groups('0::/agentes.slice/getdemo-rc.service\n')).toEqual(['/agentes.slice/getdemo-rc.service', '/agentes.slice'])
})

type Scenario = { used: number[]; commands: string[]; responses: string[]; peaks?: Record<string, number[]> }

// The session's group has the usage of the first item of `used`; each `sleep` from the mod moves to the next one.
function setup(on: Parameters<Parameters<typeof test>[1]>[1], c: Scenario) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home' })
  mock.store(on, c.peaks === undefined ? {} : { peaks: c.peaks })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', ($, e) => {
    const p = e.path
    if (p.endsWith('/proc/self/cgroup')) return { value: '0::/agentes.slice/getdemo-rc.service\n' }
    if (p.endsWith('getdemo-rc.service/memory.current')) return { value: String(c.used[0]) }
    if (p.endsWith('getdemo-rc.service/memory.high')) return { value: String(HIGH) }
    if (p.endsWith('memory.max')) return { value: 'max' }
    if (p.endsWith('agentes.slice/memory.current')) return { value: String(c.used[0]) }
    if (p.endsWith('agentes.slice/memory.high')) return { value: 'max' }
    return { deny: 'no file' }
  })
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'sleep') {
      if (c.used.length > 1) c.used.shift()
      await clock.advance(5000)
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', ($, e) => {
    c.commands.push(String(Reflect.get(e, 'command')))
    const text = c.responses.shift() ?? 'ok'
    return { result: text, text }
  })
  return clock
}

const start = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

test('a command that is not heavy passes without an estimate', async ($, on) => {
  const c = { used: [LIMIT], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(c.commands).toEqual(['ls -la'])
})

test('a command that fits runs as it came', async ($, on) => {
  const c = { used: [LIMIT - 2 * GB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn turbo run typecheck' })
  expect(c.commands).toEqual(['yarn turbo run typecheck'])
})

test('without room for the whole command, runs with a single process and tells the agent', async ($, on) => {
  const c = { used: [LIMIT - 500 * MB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(c.commands).toEqual(['yarn turbo run test --concurrency=1'])
  expect(r).toMatchObject({ context: [expect.stringContaining('single process')] })
})

test('without room even for one process, waits for memory to drop', async ($, on) => {
  const c = { used: [LIMIT - 100 * MB, LIMIT - 100 * MB, LIMIT - 2 * GB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.commands).toEqual(['npx tsc --noEmit'])
})

test('if memory does not drop in time, refuses and shows the groups', async ($, on) => {
  const c = { used: [LIMIT - 100 * MB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.commands).toEqual([])
  expect(r).toMatchObject({ deny: expect.stringContaining('/agentes.slice/getdemo-rc.service: uses') })
})

test('a command that died with 137 runs again with a single process', async ($, on) => {
  const c = { used: [LIMIT - 2 * GB], commands: [], responses: ['Exit code 137\nKilled', 'ok'] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(c.commands).toEqual(['yarn turbo run test', 'yarn turbo run test --concurrency=1'])
  expect(r).toMatchObject({ text: 'ok', context: [expect.stringContaining('died for lack of memory')] })
})

test('a previously measured peak beats the estimate', async ($, on) => {
  // tsc estimated at 1 GB would not fit in 500 MB, but the measured peak was 300 MB.
  const c = { used: [LIMIT - 500 * MB], commands: [], responses: [], peaks: { 'npx tsc': [200 * MB, 300 * MB] } }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.commands).toEqual(['npx tsc --noEmit'])
})

test('keeps only the last 3 measurements, so an inflated one ages out on its own', () => {
  expect(withMeasurement([5 * GB, 300 * MB, 310 * MB], 290 * MB)).toEqual([300 * MB, 310 * MB, 290 * MB])
  expect(withMeasurement(undefined, 1 * GB)).toEqual([1 * GB])
})
