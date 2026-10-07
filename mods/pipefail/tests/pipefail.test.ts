import { expect, test } from 'claude-code/testing'
import { needsPipefail } from '../hooks/rules.ts'

// The pipe cases of zippi's .claude/hooks/guard-bash.sh --teste: what it refuses gets pipefail here.
test('a runner piped into tail, head or grep gets pipefail', () => {
  for (const c of [
    'cd apps/bi && yarn vitest run src/x.test.ts 2>&1 | tail -20',
    'git add -A && yarn verificar 2>&1 | grep -E "FAIL|tudo verde"',
    'CI=1 yarn playwright test --reporter=list 2>&1 | tail -14',
    'timeout 590 yarn turbo run test --filter=@getdemo/bi | head -40',
    'yarn workspace @getdemo/bi e2e 2>&1 | tail',
    'yarn regras 2>&1 | head -20',
    'cd apps/bi; yarn vitest run 2>&1 | tail -5',
    'npx tsc --noEmit -p . | head -30',
    'pytest -q | tail -3',
  ]) expect([c, needsPipefail(c)]).toEqual([c, true])
})

// What guard-bash lets through stays untouched.
test('what does not hide a runner exit code is left alone', () => {
  for (const c of [
    'set -o pipefail; yarn vitest run 2>&1 | tail -20',
    'yarn turbo run test --filter=@getdemo/bi',
    'yarn verificar > /tmp/v.log 2>&1; tail -20 /tmp/v.log',
    'yarn regras > /tmp/r.log 2>&1; grep -v "^$" /tmp/r.log | head -30',
    'yarn regras > /tmp/r.log 2>&1 && grep -v "^$" /tmp/r.log | head -30',
    'yarn vitest run > /tmp/t.log 2>&1 || grep FAIL /tmp/t.log | tail -5',
    'grep -n vitest package.json | head',
    'git log --oneline | grep playwright | head',
    'echo "rode yarn vitest | tail depois" && ls',
    "git commit -F - <<'EOF'\nyarn vitest run | tail\nEOF",
  ]) expect([c, needsPipefail(c)]).toEqual([c, false])
})
