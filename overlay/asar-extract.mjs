// asar-extract.mjs — full extractor with unpacked merge + link handling.
// Usage: node asar-extract.mjs <path-to-app.asar> <outDir> [--dry]
//   --dry : walk + validate only (offsets, sizes, unpacked files present), write nothing.
// Exit 0 on success; prints progress and stats.
import { openSync, readSync, closeSync, statSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync, copyFileSync, chmodSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'

function copyDirSync(from, to) {
  mkdirSync(to, { recursive: true })
  for (const ent of readdirSync(from, { withFileTypes: true })) {
    const a = join(from, ent.name), b = join(to, ent.name)
    if (ent.isDirectory()) copyDirSync(a, b)
    else copyFileSync(a, b)
  }
}

const [asarPathArg, outDirArg, dryArg] = process.argv.slice(2)
if (!asarPathArg || !outDirArg) {
  console.error('usage: node asar-extract.mjs <asar> <outDir> [--dry]')
  process.exit(2)
}
const DRY = dryArg === '--dry'
const asarPath = resolve(asarPathArg)
const outDir = resolve(outDirArg)
const unpackedDir = asarPath + '.unpacked'
const asarSize = statSync(asarPath).size

// ── header: [u32 4][u32 headerPickleSize][u32 inner][u32 jsonLen][json][pad] ──
const head = Buffer.alloc(16)
const fd = openSync(asarPath, 'r')
readSync(fd, head, 0, 16, 0)
const headerPickleSize = head.readUInt32LE(4)
const jsonLen = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonLen)
readSync(fd, jsonBuf, 0, jsonLen, 16)
const header = JSON.parse(jsonBuf.toString('utf8'))
const filesOffset = 8 + headerPickleSize
console.log(`asar=${asarPath} size=${(asarSize / 1048576).toFixed(1)}MB headerPickle=${headerPickleSize} jsonLen=${jsonLen} filesOffset=${filesOffset}`)

let count = 0, unpackedCount = 0, linkCount = 0, bytesWritten = 0, maxEnd = 0, errors = 0
const t0 = Date.now()

function walk(node, rel) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, rel ? rel + '/' + name : name)
    return
  }
  count++
  const dest = join(outDir, ...rel.split('/'))
  // dest escape check
  if (dest !== outDir && !dest.startsWith(outDir + sep)) { console.error('ESCAPE PATH SKIPPED: ' + rel); errors++; return }
  if (node.link) {
    linkCount++
    if (!DRY) {
      // asar link entries are pnpm-style tree links; linkDestination is relative
      // to the link entry itself. Prefer a real symlink, fall back to copying.
      const target = node.linkDestination ? resolve(dirname(dest), node.linkDestination) : null
      let ok = false
      mkdirSync(dirname(dest), { recursive: true })
      if (target && existsSync(target)) {
        try { symlinkSync(target, dest); ok = true } catch {}
        if (!ok) {
          try {
            if (statSync(target).isDirectory()) copyDirSync(target, dest)
            else copyFileSync(target, dest)
            ok = true
          } catch {}
        }
      }
      if (!ok) { console.warn('link unresolved (skipped): ' + rel + ' -> ' + node.linkDestination); errors++ }
    }
    return
  }
  if (node.unpacked) {
    unpackedCount++
    const src = join(unpackedDir, ...rel.split('/'))
    if (!existsSync(src)) { console.error('MISSING unpacked file: ' + rel); errors++; return }
    if (!DRY) {
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
      bytesWritten += statSync(dest).size
    }
    return
  }
  const off = Number(node.offset ?? 0)
  const size = Number(node.size ?? 0)
  const end = filesOffset + off + size
  if (end > asarSize) { console.error('OUT OF RANGE: ' + rel + ` end=${end} > ${asarSize}`); errors++; return }
  if (end > maxEnd) maxEnd = end
  if (!DRY) {
    mkdirSync(dirname(dest), { recursive: true })
    const buf = Buffer.allocUnsafe(size)
    readSync(fd, buf, 0, size, filesOffset + off)
    writeFileSync(dest, buf)
    if (node.executable) { try { chmodSync(dest, 0o755) } catch {} }
    bytesWritten += size
  }
  if (count % 2000 === 0) console.log(`  ${count} files… (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
}

walk(header, '')
closeSync(fd)
console.log(`DONE${DRY ? ' (dry-run)' : ''}: ${count} files (${unpackedCount} unpacked, ${linkCount} links) bytes=${(bytesWritten / 1048576).toFixed(1)}MB dataSpan=${((maxEnd - filesOffset) / 1048576).toFixed(1)}MB errors=${errors} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(errors ? 1 : 0)
