#!/usr/bin/env node
/**
 * Guard: every file the shipped package needs at runtime must survive npm's
 * `files` whitelist.
 *
 * A git or tarball install is packed with that whitelist, so a path that is
 * referenced by package.json but missing from `files` fails on the *user's*
 * machine, not on ours — which is exactly how 0.3.0 shipped a bundle whose
 * `dsh.bundle.patch` (cordis.patch.yml) did not exist, and DSH refused to load
 * it ("failed to read overlay ...: ENOENT").
 *
 * Checks the manifest's own references (dsh.bundle.patch, icon, exports) and the
 * files the entry points import, then requires each to exist AND to be packed.
 * npm always packs package.json, README*, LICENSE* and CHANGELOG*, so those
 * need no whitelist entry.
 *
 * Usage: node build/check-pack.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** npm packs these regardless of `files`. */
const ALWAYS_PACKED = /^(package\.json|readme(\..*)?|licen[cs]e(\..*)?|changelog(\..*)?)$/i

const strip = (path) => path.replace(/^\.\//, '')

function globToRegExp(glob) {
  const escaped = strip(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*\*\//g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?')}$`)
}

const patterns = (pkg.files ?? []).map(globToRegExp)
const packed = (path) => ALWAYS_PACKED.test(path) || patterns.some((re) => re.test(path))

/** Expand the simple globs this manifest uses into concrete repository paths. */
function expand(glob) {
  const clean = strip(glob)
  if (!clean.includes('*')) return [clean]
  const dir = dirname(clean)
  if (dir === '.' || !existsSync(join(root, dir))) return []
  return readdirSync(join(root, dir)).map((name) => `${dir}/${name}`)
}

const declaredPatches = typeof pkg.dsh?.bundle?.patch === 'string' ? [pkg.dsh.bundle.patch] : pkg.dsh?.bundle?.patch ?? []
const exportTargets = Object.values(pkg.exports ?? {}).flatMap((value) =>
  typeof value === 'string' ? [value] : Object.values(value ?? {}),
)

const referenced = [...new Set([...declaredPatches, pkg.icon, ...exportTargets, 'index.js', 'fold.js', 'client.js']
  .filter((value) => typeof value === 'string'))]

const missing = []
const unshipped = []
for (const reference of referenced) {
  const files = expand(reference)
  if (files.length === 0) missing.push(reference)
  for (const file of files) {
    if (!existsSync(join(root, file))) missing.push(reference)
    else if (!packed(file)) unshipped.push(`${file} (referenced as ${reference})`)
  }
}

const fatal = [...new Set([...missing.map((path) => `not found: ${path}`), ...unshipped.map((path) => `not in "files": ${path}`)])]
if (fatal.length > 0) {
  console.error(`check-pack: ${pkg.name}@${pkg.version} would ship a broken package:`)
  for (const line of fatal) console.error(`  - ${line}`)
  console.error('A git/tarball install packs only "files", so the installed plugin would miss these.')
  process.exit(1)
}

console.log(`check-pack: ok — ${referenced.length} referenced paths, all present and inside "files" (${pkg.name}@${pkg.version})`)
