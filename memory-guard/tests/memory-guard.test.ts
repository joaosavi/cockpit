import { expect, mock, test } from 'claude-code/testing'
import { groups, headroom, heavy, inactiveFile, macMemory, macTotal, reduced, refusalText, statusText, windowsMemory, withMeasurement, workingSet } from '../hooks/rules.ts'

const MB = 1024 * 1024
const GB = 1024 * MB
const HIGH = 3 * GB
const MAX = 3.5 * GB
// With the 2% margin, up to 98% of the high mark fits.
const LIMIT = MAX * 0.98

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
    { group: '/a/b', used: 1 * GB, inactiveFile: 0, high: 3 * GB, max: null },
    { group: '/a', used: 4 * GB, inactiveFile: 0, high: 4.5 * GB, max: null },
  ]
  expect(headroom(levels, null, 0)).toBe(0.5 * GB)
  expect(headroom([], { available: 8 * GB, total: 16 * GB }, 2)).toBe(8 * GB - 16 * GB * 0.02)
  // The max, where the kernel kills, wins over the high mark, where the group only slows down.
  expect(headroom([{ group: '/a', used: 3 * GB, inactiveFile: 0, high: 3 * GB, max: 3.5 * GB }], null, 0)).toBe(0.5 * GB)
  expect(groups('0::/agents.slice/demo.service\n')).toEqual(['/agents.slice/demo.service', '/agents.slice'])
})

type Scenario = {
  used: number[]
  commands: string[]
  responses: string[]
  peaks?: Record<string, number[]>
  // The `inactive_file` of the session's group, and its own high and max, when a test needs them.
  inactive?: number
  high?: number | 'max'
  max?: number | 'max'
  // The surfaces /ram sees, and the panes it opened.
  surfaces?: string[]
  opened?: string[]
  // The lines the mod wrote to its diary.
  written?: string[]
}

// The session's group has the usage of the first item of `used`; each `sleep` from the mod moves to the next one.
function setup(on: Parameters<Parameters<typeof test>[1]>[1], c: Scenario) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home' })
  mock.store(on, c.peaks === undefined ? {} : { peaks: c.peaks })
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.write', ($, e) => {
    c.written?.push(e.text)
    return { value: undefined }
  })
  on('session.end', () => ({ sessionId: 'abcdef123456' }))
  on('fs.read', ($, e) => {
    const p = e.path
    if (p.endsWith('/proc/self/cgroup')) return { value: '0::/agents.slice/demo.service\n' }
    if (p.endsWith('demo.service/memory.current')) return { value: String(c.used[0]) }
    if (p.endsWith('demo.service/memory.high')) return { value: String(c.high ?? HIGH) }
    if (p.endsWith('demo.service/memory.max')) return { value: String(c.max ?? MAX) }
    if (p.endsWith('demo.service/memory.stat')) return { value: `anon 1000\ninactive_file ${c.inactive ?? 0}\nactive_file 2000\n` }
    if (p.endsWith('memory.max')) return { value: 'max' }
    if (p.endsWith('agents.slice/memory.current')) return { value: String(c.used[0]) }
    if (p.endsWith('agents.slice/memory.high')) return { value: 'max' }
    return { deny: 'no file' }
  })
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'sleep') {
      if (c.used.length > 1) c.used.shift()
      await clock.advance(5000)
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.surfaces', () => ({ value: c.surfaces ?? [] }))
  on('ui.open', ($, e) => {
    c.opened?.push(e.id)
    return { value: { isPlaced: true } }
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
  expect(r).toMatchObject({ deny: expect.stringContaining('/agents.slice/demo.service: ') })
})

test('a command that died with 137 runs again with a single process', async ($, on) => {
  const c = { used: [LIMIT - 2 * GB], commands: [], responses: ['Exit code 137\nKilled', 'ok'] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(c.commands).toEqual(['yarn turbo run test', 'yarn turbo run test --concurrency=1'])
  expect(r).toMatchObject({ text: 'ok', context: [expect.stringContaining('died of memory')] })
})

test('with reduce off, a command that only fits with one process waits instead', { options: { reduce: false } }, async ($, on) => {
  const c = { used: [LIMIT - 500 * MB, LIMIT - 2 * GB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(c.commands).toEqual(['yarn turbo run test'])
})

test('with wait off, a command that does not fit is refused at once', { options: { wait: false } }, async ($, on) => {
  const c = { used: [LIMIT - 100 * MB, LIMIT - 2 * GB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.commands).toEqual([])
  expect(r).toMatchObject({ deny: expect.stringContaining('after waiting 0s') })
})

test('with refuse off, a command that never fits runs as written after the wait', { options: { refuse: false } }, async ($, on) => {
  const c = { used: [LIMIT - 100 * MB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.commands).toEqual(['npx tsc --noEmit'])
  expect(r).not.toHaveProperty('deny')
})

test('with retry137 off, a command that died with 137 is not run again', { options: { retry137: false } }, async ($, on) => {
  const c = { used: [LIMIT - 2 * GB], commands: [], responses: ['Exit code 137\nKilled', 'ok'] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(c.commands).toEqual(['yarn turbo run test'])
})

test('disabled, a heavy command runs as it came, whatever the memory', { options: { enabled: false } }, async ($, on) => {
  const c = { used: [LIMIT - 100 * MB], commands: [], responses: [] }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.commands).toEqual(['npx tsc --noEmit'])
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

test('the usage is memory.current minus inactive_file, the working set', () => {
  expect(inactiveFile('anon 5\ninactive_file 1073741824\nactive_file 7\n')).toBe(GB)
  expect(inactiveFile('anon 5\n')).toBe(0)
  expect(workingSet(3.86 * GB, GB)).toBe(2.86 * GB)
  expect(workingSet(GB, 2 * GB)).toBe(0)
  // memory.current 3.86 GiB, 1 GiB of it inactive file cache, high 4.5 GiB, no max, 2% margin.
  const h = headroom([{ group: '/a', used: workingSet(3.86 * GB, GB), inactiveFile: GB, high: 4.5 * GB, max: null }], null, 2) ?? 0
  expect(h > 1.5 * GB && h < 1.6 * GB).toBe(true)
})

test('a 1 GB command fits when the group holds 1 GB of inactive file cache', async ($, on) => {
  const c = { used: [3.86 * GB], commands: [], responses: [], inactive: GB, high: 4.5 * GB, max: 'max' as const }
  setup(on, c)
  await $.session.start(start)
  // Without the cache deduction the headroom would be 0.55 GiB, and this tsc (1 GiB) would wait and be refused.
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(c.commands).toEqual(['npx tsc --noEmit'])
})

test('/ram leads with the headroom and shows the file cache behind it', async ($, on) => {
  const c = { used: [3.86 * GB], commands: [], responses: [], inactive: GB, high: 4.5 * GB, max: 'max' as const }
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'ram', args: '' })
  expect(r.text).toBe(
    'Headroom: 1587 MB, after the 2% margin\n' +
      '/agents.slice/demo.service: 2929 MB in use, 1024 MB file cache, high 4608 MB\n' +
      '/agents.slice: 3953 MB in use, no limit',
  )
})

const PANE = {
  plugin: 'memory-guard',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'ram',
  props: { title: 'Memory', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('/ram opens the Memory pane with the headroom, a legend, a block per group and the key hint', async ($, on) => {
  const opened: string[] = []
  // memory.current is 3 GB, 1 GB of it inactive file cache.
  const c = { used: [3 * GB], commands: [], responses: [], inactive: GB, peaks: { 'npx tsc': [300 * MB] }, surfaces: ['terminal'], opened }
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'ram', args: '' })
  // The text reply stays the same, for Remote Control.
  expect(r.text).toContain('2048 MB in use, 1024 MB file cache, high 3072 MB, max 3584 MB')
  expect(opened).toEqual(['ram'])
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: '/agents.slice/demo.service' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2048 MB in use · 1024 MB cache · high 3072 MB · max 3584 MB' })).toBeDefined()
  // 2 GB of 3.43 GB usable is 58%: green. The high mark at 3 GB of 3.5 GB is drawn.
  expect(await ui.find({ type: 'Text', text: /^█+$/ })).toMatchObject({ props: { color: 'success' } })
  expect(await ui.find({ type: 'Text', text: /^▒+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '│' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Headroom: 1464 MB, after the 2% margin' })).toMatchObject({ props: { bold: true } })
  expect(await ui.find({ type: 'Text', text: '█ in use  ▒ file cache  ░ free  │ high mark' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Measured peak of npx tsc: 300 MB' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'updates every 2s · esc closes' })).toBeDefined()
})

test('pressing refresh in the Memory pane reads the groups again', async ($, on) => {
  const c = { used: [2 * GB], commands: [], responses: [], surfaces: ['terminal'] }
  setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'ram', args: '' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^2048 MB in use/ })).toBeDefined()
  c.used[0] = 3.3 * GB
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /^3379 MB in use/ })).toBeDefined()
  // 3.3 GB of 3.43 GB usable: red.
  expect(await ui.find({ type: 'Text', text: /^█+$/ })).toMatchObject({ props: { color: 'error' } })
})

test('the Memory pane refreshes every 2 seconds while open', async ($, on) => {
  const c = { used: [2 * GB], commands: [], responses: [], surfaces: ['terminal'] }
  const clock = setup(on, c)
  await $.session.start(start)
  await $.command.run({ command: 'ram', args: '' })
  const ui = await $.ui.mount(PANE)
  c.used[0] = 2.5 * GB
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /^2560 MB in use/ })).toBeDefined()
})

test('/ram without a surface that draws answers with text only', async ($, on) => {
  const opened: string[] = []
  const c = { used: [2 * GB], commands: [], responses: [], opened }
  setup(on, c)
  await $.session.start(start)
  const r = await $.command.run({ command: 'ram', args: '' })
  expect(r.text).toContain('/agents.slice/demo.service: 2048 MB in use, high 3072 MB, max 3584 MB')
  expect(opened).toEqual([])
})

test('the session ends with one summary line: calls, actions, time held waiting and refusals', async ($, on) => {
  const written: string[] = []
  // Two waits of 5 s before the first tsc fits, then a full 120 s wait that ends in a refusal.
  const c: Scenario = { used: [LIMIT - 100 * MB, LIMIT - 100 * MB, LIMIT - 2 * GB], commands: [], responses: [], written }
  setup(on, c)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  c.used = [LIMIT - 100 * MB]
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  await $.session.end({ reason: 'other', sessionId: 'abcdef123456', resume: { id: 'abcdef123456' } })
  const last: unknown = JSON.parse(written.at(-1) ?? '{}')
  expect(last).toMatchObject({
    event: 'session-summary',
    session: 'abcdef12',
    cwd: '/work',
    toolCalls: 3,
    actions: { waited: 2, refused: 1 },
    waitedMs: 10_000 + 120_000,
    refused: 1,
    // The waits are not the hook's own time.
    hookMs: 0,
    maxHookMs: 0,
  })
  expect(written.filter((l) => l.includes('session-summary')).length).toBe(1)
})

test('the status line shows only when the headroom is under 500 MB, and the agent texts name the mod', () => {
  expect(statusText(null)).toBeUndefined()
  expect(statusText(600 * MB)).toBeUndefined()
  expect(statusText(420 * MB)).toBe('Memory headroom: 420 MB')
  expect(statusText(-5 * MB)).toBe('Memory headroom: 0 MB')
  const h = { kind: 'typecheck', key: 'npx tsc' } as const
  expect(refusalText(h, 120, 'Headroom: 10 MB, after the 2% margin')).toBe(
    'memory-guard: refused npx tsc after waiting 120s for memory; another session or process holds it.\nHeadroom: 10 MB, after the 2% margin\n' +
      'Tell the user, or continue with work that does not need this command.',
  )
})

// Sample outputs, copied in shape from a Mac and a Windows PC. The real commands never ran in these
// tests: the macOS and Windows paths are checked only against this simulated output.
const VM_STAT = (free: number, inactive: number) => `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               ${free}.
Pages active:                            401234.
Pages inactive:                          ${inactive}.
Pages speculative:                         1000.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                           2000.
"Translation faults":                 123456789.
Pages copy-on-write:                    1234567.
Swapins:                                      0.
Swapouts:                                     0.
`
const MEMSIZE = '17179869184\n'
const PS = (freeKiB: number) => `{\r\n    "TotalVisibleMemorySize":  16658432,\r\n    "FreePhysicalMemory":  ${freeKiB}\r\n}\r\n`

test('reads the macOS total and the free, inactive, speculative and purgeable pages', () => {
  expect(macTotal(MEMSIZE)).toBe(16 * GB)
  expect(macTotal('')).toBeNull()
  expect(macTotal('sysctl: unknown oid')).toBeNull()
  expect(macMemory(MEMSIZE, VM_STAT(10000, 200000))).toEqual({ total: 16 * GB, available: (10000 + 200000 + 1000 + 2000) * 16384 })
  // Intel Macs print a 4096-byte page.
  expect(macMemory(MEMSIZE, VM_STAT(10000, 0).replace('16384', '4096'))?.available).toBe(13000 * 4096)
  expect(macMemory(MEMSIZE, 'garbage')).toBeNull()
  expect(macMemory('', VM_STAT(1, 1))).toBeNull()
  // Never more available than the total.
  expect(macMemory('1000', VM_STAT(10000, 0))).toEqual({ total: 1000, available: 1000 })
})

test('reads the Windows total and free memory from the PowerShell JSON, in KiB', () => {
  expect(windowsMemory(PS(8000000))).toEqual({ total: 16658432 * 1024, available: 8000000 * 1024 })
  expect(windowsMemory('{"TotalVisibleMemorySize":"1024","FreePhysicalMemory":"512"}')).toEqual({ total: 1024 * 1024, available: 512 * 1024 })
  expect(windowsMemory('')).toBeNull()
  expect(windowsMemory('Get-CimInstance : Access denied')).toBeNull()
  expect(windowsMemory('{"TotalVisibleMemorySize":16658432}')).toBeNull()
  expect(windowsMemory('null')).toBeNull()
})

type System = {
  env: Record<string, string>
  // What each command prints, by its first word; a missing one cannot start.
  outputs: Record<string, string | (() => string)>
  ran: string[]
  commands: string[]
  statuses?: unknown[]
}

// A Mac or Windows PC: no /proc and no cgroups, so memory comes only from the system's commands.
function system(on: Parameters<Parameters<typeof test>[1]>[1], s: System) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, s.env)
  mock.store(on, {})
  on('session.id', () => ({ value: 'abcdef123456' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', ($, e) => {
    s.statuses?.push(Reflect.get(e, 'text'))
    return { value: undefined }
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('session.surfaces', () => ({ value: [] }))
  on('process.run', async ($, e) => {
    const name = e.argv[0] ?? ''
    s.ran.push(name)
    if (name === 'sleep') {
      await clock.advance(5000)
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    }
    const out = s.outputs[name]
    if (out === undefined) return { deny: 'ENOENT: command not found' }
    return { value: { exitCode: 0, stdout: typeof out === 'function' ? out() : out, stderr: '' } }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', ($, e) => {
    s.commands.push(String(Reflect.get(e, 'command')))
    return { result: 'ok', text: 'ok' }
  })
  return clock
}

test('on macOS, a heavy command that fits the available memory runs as it came', async ($, on) => {
  // 16 GB total and a 2% margin of 328 MB; 77000 pages of 16 KiB are 1203 MB available, so 875 MB of
  // headroom, over the 600 MB vitest estimate.
  const s: System = { env: { HOME: '/Users/u' }, outputs: { sysctl: MEMSIZE, vm_stat: VM_STAT(10000 + 64000, 0) }, ran: [], commands: [] }
  system(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
  expect(s.commands).toEqual(['npx vitest run'])
  expect(s.ran).toContain('vm_stat')
})

test('on macOS, without room for tsc, waits, then refuses and shows the machine', async ($, on) => {
  // 13000 pages of 16 KiB are 203 MB available, under the 328 MB margin.
  const s: System = { env: { HOME: '/Users/u' }, outputs: { sysctl: MEMSIZE, vm_stat: VM_STAT(10000, 0) }, ran: [], commands: [] }
  system(on, s)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(s.commands).toEqual([])
  expect(r).toMatchObject({ deny: expect.stringContaining('Machine: 203 MB available of 16384 MB') })
})

test('on Windows, reads memory through PowerShell and reduces a command that does not fit whole', async ($, on) => {
  // 16268 MB total and a 2% margin of 325 MB; 900 MB free leaves 575 MB, under the 600 MB test
  // estimate and over the 360 MB of the reduced run.
  const s: System = { env: { USERPROFILE: 'C:/Users/u', OS: 'Windows_NT' }, outputs: { powershell: PS(900 * 1024) }, ran: [], commands: [] }
  system(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'yarn turbo run test' })
  expect(s.commands).toEqual(['yarn turbo run test --concurrency=1'])
  expect(s.ran).not.toContain('sysctl')
})

test('on Windows, one PowerShell reading serves the next 10 seconds', async ($, on) => {
  const s: System = { env: { USERPROFILE: 'C:/Users/u', OS: 'Windows_NT' }, outputs: { powershell: PS(8000000) }, ran: [], commands: [] }
  const clock = system(on, s)
  await $.session.start(start)
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  const first = s.ran.filter((r) => r === 'powershell').length
  expect(first).toBe(1)
  await clock.advance(11_000)
  await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(s.ran.filter((r) => r === 'powershell').length).toBe(2)
  expect(s.commands.length).toBe(3)
})

test('when the system commands fail, a heavy command runs as it came and nothing shows', async ($, on) => {
  const statuses: unknown[] = []
  const s: System = { env: { USERPROFILE: '/users/u' }, outputs: {}, ran: [], commands: [], statuses }
  system(on, s)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn turbo run typecheck' })
  expect(r).not.toHaveProperty('deny')
  expect(r).not.toHaveProperty('context')
  expect(s.commands).toEqual(['yarn turbo run typecheck'])
  expect(s.ran).toEqual(['sysctl'])
  expect(statuses.every((x) => x === undefined)).toBe(true)
})

test('when PowerShell prints an error, a heavy command runs as it came', async ($, on) => {
  const s: System = { env: { OS: 'Windows_NT' }, outputs: { powershell: 'Get-CimInstance : Access denied' }, ran: [], commands: [] }
  system(on, s)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Bash', command: 'npx tsc --noEmit' })
  expect(r).not.toHaveProperty('deny')
  expect(s.commands).toEqual(['npx tsc --noEmit'])
})
