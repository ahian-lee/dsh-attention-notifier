// patch-app-dir.mjs — idempotently append the overlay injections to the staged
// app dir (lib/main.js + lib/preload-app.cjs). Usage:
//   node patch-app-dir.mjs <appDir> [--revert]
// --revert strips ALL previously injected blocks (any patch version, between
// the marker comments). Append is a no-op when a CURRENT-version block exists.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [appDirArg, modeArg] = process.argv.slice(2)
if (!appDirArg) { console.error('usage: node patch-app-dir.mjs <appDir> [--revert]'); process.exit(2) }
const REVERT = modeArg === '--revert'
const ANY_BEGIN = /\/\/ ==== <dsh-attention-overlay patch v\d+> ====/.source
const MARKER_RX = new RegExp(ANY_BEGIN + '|// ==== </dsh-attention-overlay patch v\\d+> ====', 'g')
const CURRENT = '// ==== <dsh-attention-overlay patch v2> ===='

const targets = REVERT
  ? [join(appDirArg, 'lib', 'main.js'), join(appDirArg, 'lib', 'preload-app.cjs')]
  : [
      { file: join(appDirArg, 'lib', 'main.js'), snippet: join(here, 'injections', 'main-append.txt') },
      { file: join(appDirArg, 'lib', 'preload-app.cjs'), snippet: join(here, 'injections', 'preload-append.txt') },
    ]

for (const t of targets) {
  if (REVERT) {
    if (!existsSync(t)) { console.log('skip (absent): ' + t); continue }
    let src = readFileSync(t, 'utf8')
    let removed = 0
    // Remove every marker-delimited block (oldest first, re-scanning each pass).
    for (;;) {
      MARKER_RX.lastIndex = 0
      const begin = src.match(new RegExp('// ==== <dsh-attention-overlay patch v\\d+> ===='))
      if (!begin || begin.index === undefined) break
      const endRx = new RegExp('// ==== </dsh-attention-overlay patch v\\d+> ====')
      const end = src.slice(begin.index).match(endRx)
      if (!end || end.index === undefined) { console.error('MARKER PAIR BROKEN — refuse to touch: ' + t); process.exit(1) }
      const cut = begin.index + end.index + end[0].length
      src = src.slice(0, begin.index) + src.slice(cut)
      removed++
    }
    if (removed === 0) { console.log('not patched: ' + t); continue }
    writeFileSync(t, src.replace(/\n{3,}$/g, '\n'))
    console.log('REVERTED x' + removed + ': ' + t)
    continue
  }
  const { file, snippet } = t
  if (!existsSync(file)) { console.error('MISSING target: ' + file); process.exit(1) }
  const src = readFileSync(file, 'utf8')
  if (src.includes(CURRENT)) { console.log('already patched (current): ' + file); continue }
  writeFileSync(file, src + '\n' + readFileSync(snippet, 'utf8'))
  console.log('PATCHED: ' + file + ' (+' + readFileSync(snippet, 'utf8').length + 'B)')
}
console.log('patch-app-dir done')
