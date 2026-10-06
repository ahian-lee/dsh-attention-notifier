// gen-builtin-sounds.mjs — the release build step for the client entry.
// Reads <soundtrackDir> (default: the shipped sounds/hachimi cat collection),
// base64-encodes the matching audio and replaces the /*BUILTIN_DATA*/ anchor
// in ../client.src.js, writing the RUNTIME entry ../client.js:
//   done  row: blue lotus, north south, mambo
//   alert row: neige, electric neige
// Files that do not exist are skipped; with nothing found the output equals
// the source (empty builtin list) so installs never break.
// client.src.js is the source of truth; client.js is generated, committed.
// Usage: node build/gen-builtin-sounds.mjs [soundtrackDir]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const srcPath = join(root, 'client.src.js')
const outPath = join(root, 'client.js')
const soundDir = process.argv[2] || join(root, 'sounds', 'hachimi')

// [matcher(lowercase substring test), kind, id, display name]
const SPEC = [
	[(n) => n.includes('blue') , 'done', 'bt-blue', 'Blue Lotus'],
	[(n) => n.includes('north_south') || n.includes('northsouth'), 'done', 'bt-north', 'North South'],
	[(n) => n.includes('mambo'), 'done', 'bt-mambo', 'Mambo'],
	[(n) => n.includes('electric') && n.includes('neige'), 'alert', 'bt-eneige', 'Electric Neige'],
	[(n) => n.includes('neige') && !n.includes('electric'), 'alert', 'bt-neige', 'Neige'],
]

const ANCHOR = '/*BUILTIN_DATA*/ { alert: [], done: [] }'
const data = { alert: [], done: [] }
let usedFiles = 0
if (existsSync(soundDir)) {
	const files = readdirSync(soundDir).filter((f) => /\.(mp3|wav|ogg|m4a|flac)$/i.test(f))
	for (const [match, kind, id, name] of SPEC) {
		const file = files.find((f) => match(f.toLowerCase()))
		if (!file) { console.log(`skip ${name}: no file for it`); continue }
		const buf = readFileSync(join(soundDir, file))
		if (buf.length > 6 * 1024 * 1024) { console.log(`skip ${name}: ${file} over 6MB`); continue }
		const mime = /\.(wav)$/i.test(file) ? 'audio/wav' : /\.(ogg)$/i.test(file) ? 'audio/ogg' : 'audio/mpeg'
		data[kind].push({ id, name, file, url: `data:${mime};base64,${buf.toString('base64')}` })
		usedFiles += 1
		console.log(`bake ${name} <- ${file} (${Math.round(buf.length / 1024)}KB) -> ${kind}`)
	}
} else {
	console.log(`soundtrack dir missing (${soundDir}); emitting empty builtin`)
}

const src = readFileSync(srcPath, 'utf8')
if (!src.includes(ANCHOR)) { console.error('ANCHOR NOT FOUND in client.js — refusing to write'); process.exit(1) }
const out = src.replace(ANCHOR, '/*BUILTIN_DATA*/ ' + JSON.stringify(data))
writeFileSync(outPath, out)
console.log(`client entry written: ${outPath} (${Math.round(out.length / 1024)}KB, ${usedFiles} songs)`)
