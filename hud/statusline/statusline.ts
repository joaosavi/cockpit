// The hud's status line command: turns on Node's compile cache, then draws with draw.ts. Node strips
// the types of the hud's 2 000 lines of TypeScript and compiles them on every run, about 0.4 s of CPU,
// while the drawing itself takes a few hundredths. The cache keeps the compiled code on disk, keyed by
// each file's content, so an edited file compiles again on its next run. statusline.sh sets
// NODE_COMPILE_CACHE to the same folder, which caches this file too; run as `node statusline.ts`, as
// on Windows, only the files imported after this call are cached.

import { enableCompileCache } from 'node:module'
import { homedir } from 'node:os'

try {
  enableCompileCache(`${process.env['HOME'] || homedir()}/.cache/mods/hud/compile`)
} catch {
  // a Node without the cache, or a folder it cannot write: the status line draws without it
}
await import('./draw.ts')
