import { expect, test } from 'claude-code/testing'
import { needsPipefail, options, runnerKey } from '../hooks/rules.ts'

// A repo's own check scripts, given through the extraRunners option.
const EXTRA = ['verify', 'rules']

// The pipe cases of a repo guard script that refuses such pipes: what it refuses gets pipefail here.
test('a runner piped into tail, head or grep gets pipefail', () => {
  for (const c of [
    'cd apps/bi && yarn vitest run src/x.test.ts 2>&1 | tail -20',
    'CI=1 yarn playwright test --reporter=list 2>&1 | tail -14',
    'timeout 590 yarn turbo run test --filter=@acme/web | head -40',
    'yarn workspace @acme/web e2e 2>&1 | tail',
    'cd apps/bi; yarn vitest run 2>&1 | tail -5',
    'npx tsc --noEmit -p . | head -30',
    'pytest -q | tail -3',
  ]) expect([c, needsPipefail(c)]).toEqual([c, true])
})

const EXTRA_PIPES = ['git add -A && yarn verify 2>&1 | grep -E "FAIL|all green"', 'yarn rules 2>&1 | head -20', 'npm run verify | tail', 'bun run rules:all | tail', 'pnpm --filter web verify | head']

test('an extra runner from the options gets pipefail, and is left alone without the option', () => {
  for (const c of EXTRA_PIPES) {
    expect([c, needsPipefail(c, EXTRA)]).toEqual([c, true])
    expect([c, needsPipefail(c)]).toEqual([c, false])
  }
  expect(runnerKey('yarn verify 2>&1 | tail', EXTRA)).toBe('yarn verify')
  expect(needsPipefail('yarn xay | tail', ['x.y'])).toBe(false)
  expect(needsPipefail('yarn x.y | tail', ['x.y'])).toBe(true)
})

test('extraRunners reads a list or a comma separated string, and drops what is not a script name', () => {
  expect(options({}).extraRunners).toEqual([])
  expect(options({ extraRunners: ['verify', ' rules ', 'verify', 'a|b', ''] }).extraRunners).toEqual(['verify', 'rules'])
  expect(options({ extraRunners: 'verify, rules' }).extraRunners).toEqual(['verify', 'rules'])
})

// What guard-bash lets through stays untouched.
test('what does not hide a runner exit code is left alone', () => {
  for (const c of [
    'set -o pipefail; yarn vitest run 2>&1 | tail -20',
    'yarn turbo run test --filter=@acme/web',
    'yarn vitest run > /tmp/t.log 2>&1 || grep FAIL /tmp/t.log | tail -5',
    'grep -n vitest package.json | head',
    'git log --oneline | grep playwright | head',
    'echo "run yarn vitest | tail later" && ls',
    "git commit -F - <<'EOF'\nyarn vitest run | tail\nEOF",
  ]) expect([c, needsPipefail(c)]).toEqual([c, false])
  for (const c of [
    'yarn verify > /tmp/v.log 2>&1; tail -20 /tmp/v.log',
    'yarn rules > /tmp/r.log 2>&1; grep -v "^$" /tmp/r.log | head -30',
    'yarn rules > /tmp/r.log 2>&1 && grep -v "^$" /tmp/r.log | head -30',
  ]) expect([c, needsPipefail(c, EXTRA)]).toEqual([c, false])
})

test('the diary key is the runner without its arguments', () => {
  expect(runnerKey('cd apps/bi && yarn vitest run src/x.test.ts 2>&1 | tail -20')).toBe('yarn vitest')
  expect(runnerKey('timeout 590 yarn turbo run test --filter=@acme/web | head -40')).toBe('yarn turbo run test')
  expect(runnerKey('CI=1 yarn playwright test --reporter=list 2>&1 | tail -14')).toBe('yarn playwright')
  expect(runnerKey('npx tsc --noEmit -p . | head -30')).toBe('npx tsc')
  expect(runnerKey('pytest -q | tail -3')).toBe('pytest')
})
