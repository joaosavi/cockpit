import { expect, test } from 'claude-code/testing'

test('the hook runs the rewritten command and tells the agent', async ($, on) => {
  const ran: string[] = []
  on('tool.call', ($, e) => {
    ran.push(String(Reflect.get(e, 'command')))
    return { result: 'ok', text: 'ok' }
  })
  const r = await $.tool.call({ tool: 'Bash', command: 'yarn vitest run 2>&1 | tail -5' })
  expect(ran).toEqual(['set -o pipefail; yarn vitest run 2>&1 | tail -5'])
  expect(r).toMatchObject({ context: [expect.stringContaining('set -o pipefail')] })
  await $.tool.call({ tool: 'Bash', command: 'ls | head' })
  expect(ran[1]).toBe('ls | head')
})
