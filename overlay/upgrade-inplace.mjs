// upgrade-inplace.mjs — upgrade the overlay patch inside an EXISTING staged app dir.
// Unlike apply-attention-overlay.ps1 (which re-extracts and swaps), this rewrites
// only lib/main.js + lib/preload-app.cjs: strip every previous v\d+ block, append
// the current (v4) one, syntax-check, and keep .bak backups.
// Usage: node upgrade-inplace.mjs <appDir> [--dry]
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [appDir, dryArg] = process.argv.slice(2)
const DRY = dryArg === '--dry'
if (!appDir) { console.error('usage: node upgrade-inplace.mjs <appDir> [--dry]'); process.exit(2) }

const targets = [
  { file: join(appDir, 'lib', 'main.js'), snippet: join(here, 'injections', 'main-append.txt'), esm: true },
  { file: join(appDir, 'lib', 'preload-app.cjs'), snippet: join(here, 'injections', 'preload-append.txt'), esm: false },
]

const BEGIN_RX = /\/\/ ==== <dsh-attention-overlay patch v\d+> ====/
const END_RX = /\/\/ ==== <\/dsh-attention-overlay patch v\d+> ====/

for (const t of targets) {
  if (!existsSync(t.file)) { console.error('MISSING target: ' + t.file); process.exit(1) }
  const snippet = readFileSync(t.snippet, 'utf8')
  const CURRENT = snippet.match(BEGIN_RX)[0]
  let src = readFileSync(t.file, 'utf8')

  // 1) strip every previous block (paired markers only; refuse on broken pairs)
  let removed = 0
  for (;;) {
    const begin = src.match(BEGIN_RX)
    if (!begin) break
    const rest = src.slice(begin.index)
    const end = rest.match(END_RX)
    if (!end) { console.error('MARKER PAIR BROKEN — refuse to touch: ' + t.file); process.exit(1) }
    const cut = begin.index + end.index + end[0].length
    src = src.slice(0, begin.index) + src.slice(cut)
    removed++
  }
  if (src.includes(CURRENT)) {
    console.log('already current: ' + t.file)
    continue
  }
  const bak = t.file + '.bak-patchv4'
  if (!existsSync(bak)) copyFileSync(t.file, bak)
  const next = src.replace(/\n{3,}$/g, '\n') + '\n' + snippet
  console.log((DRY ? '[dry] would patch ' : 'PATCHED ') + t.file +
    ` (removed ${removed} old block(s), +${snippet.length}B)`)
  if (!DRY) writeFileSync(t.file, next)
}
console.log(DRY ? 'dry-run done (nothing written)' : 'upgrade-inplace done — restart DSH to load the new patch')
