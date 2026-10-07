#!/usr/bin/env node
// Exports the rating mod's dataset as SFT, DPO or reward-model JSONL. Plain Node, no dependencies.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseJsonl, select } from './lib.mjs'

const HELP = `Usage: node export.mjs --format sft|dpo|reward --out FILE [options]

Reads turns/, ratings/ and signals/ under the dataset folder and writes one JSONL file.

Options:
  --dir DIR          dataset folder (default ~/datasets/agent-ratings)
  --format F         sft: {messages, meta} for turns scored >= --min-score
                     dpo: {prompt, chosen, rejected, meta} from a bad turn and its fixed retry
                     reward: {prompt, response, score, source, id} for every scored turn
  --min-score N      lowest score kept by sft (default 4)
  --source S         user, implicit or both (default user). both prefers the user's score
  --since YYYY-MM-DD only turns that started on or after this day
  --out FILE         output file
  --help             show this text
`

function parseArgs(argv) {
  const opts = { dir: '~/datasets/agent-ratings', minScore: 4, source: 'user', since: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--dir') opts.dir = value()
    else if (a === '--format') opts.format = value()
    else if (a === '--min-score') opts.minScore = Number(value())
    else if (a === '--source') opts.source = value()
    else if (a === '--since') opts.since = value()
    else if (a === '--out') opts.out = value()
    else throw new Error(`unknown option: ${a}`)
  }
  return opts
}

function readKind(dir, kind) {
  let names = []
  try {
    names = readdirSync(join(dir, kind)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()
  } catch {
    return []
  }
  return names.flatMap((n) => parseJsonl(readFileSync(join(dir, kind, n), 'utf8')))
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP}`)
    return 2
  }
  if (opts.help) {
    process.stdout.write(HELP)
    return 0
  }
  const problems = []
  if (!['sft', 'dpo', 'reward'].includes(opts.format)) problems.push('--format must be sft, dpo or reward')
  if (!['user', 'implicit', 'both'].includes(opts.source)) problems.push('--source must be user, implicit or both')
  if (!Number.isFinite(opts.minScore)) problems.push('--min-score must be a number')
  if (opts.since !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) problems.push('--since must be YYYY-MM-DD')
  if (opts.out === undefined) problems.push('--out is required')
  if (problems.length > 0) {
    process.stderr.write(`${problems.join('\n')}\n\n${HELP}`)
    return 2
  }
  const dir = opts.dir === '~' || opts.dir.startsWith('~/') ? homedir() + opts.dir.slice(1) : opts.dir
  const data = { turns: readKind(dir, 'turns'), ratings: readKind(dir, 'ratings'), signals: readKind(dir, 'signals') }
  const rows = select(opts.format, data, opts)
  writeFileSync(opts.out, rows.map((r) => JSON.stringify(r) + '\n').join(''))
  process.stdout.write(`${rows.length} ${opts.format} line(s) from ${data.turns.length} turn(s) written to ${opts.out}\n`)
  return 0
}

process.exitCode = main()
