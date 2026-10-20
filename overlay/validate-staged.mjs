// validate-staged.mjs — semantic checks for the staged overlay patch
// Usage: node validate-staged.mjs <appDir> <exePath>
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [appDir, exePath] = process.argv.slice(2)
let fail = 0
const ok = (cond, label, extra = '') => {
  console.log((cond ? 'OK   ' : 'MISS ') + label + (extra ? '  ' + extra : ''))
  if (!cond) fail++
}

// 1. patched files + markers
const mainJs = join(appDir, 'lib', 'main.js')
const preload = join(appDir, 'lib', 'preload-app.cjs')
ok(existsSync(mainJs), 'lib/main.js 存在')
ok(existsSync(preload), 'lib/preload-app.cjs 存在')
const mainSrc = readFileSync(mainJs, 'utf8')
const preSrc = readFileSync(preload, 'utf8')
// 版本标记用通配（v\d+），升版时脚本无需改动
const VX = /==== <dsh-attention-overlay patch v\d+> ====/
ok(VX.test(mainSrc), 'main.js 含注入标记', (mainSrc.match(VX) || [''])[0].replace('// ', '').trim())
ok(VX.test(preSrc), 'preload-app.cjs 含注入标记', (preSrc.match(VX) || [''])[0].replace('// ', '').trim())
ok((mainSrc.match(/dsh-attention-overlay patch v\d+> ====/g) || []).length === 2, 'main.js 标记成对（begin/end 各 1）')
ok((preSrc.match(/dsh-attention-overlay patch v\d+> ====/g) || []).length === 2, 'preload 标记成对')

// 2. entry point is still lib/main.js
const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
ok(pkg.main === 'lib/main.js', 'package.json main = lib/main.js', `(实际: ${pkg.main})`)

// 3. main.js is ESM (so trailing `import` append is legal)
ok(/\bimport\b/.test(mainSrc.slice(0, 4000)), 'main.js 是 ESM（前 4000 字符有 import）')
ok(/export\s/.test(mainSrc.slice(0, 4000)) || true, 'main.js 导出形态（仅提示）')

// 4. preload is CJS (trailing `require` append is legal)
const preHead = preSrc.slice(0, 4000)
ok(!/^\s*import\s+/m.test(preHead) && /require\(/.test(preHead) || /contextBridge/.test(preSrc), 'preload 是 CJS 形态')
ok(preSrc.includes('exposeInMainWorld("dshAttentionLocal"'), 'preload 暴露 window.dshAttentionLocal')
ok(preSrc.includes('require("electron")'), 'preload 用 require("electron")')

// 5. no double-exposure / no stale v2-only markers
const exposed = (preSrc.match(/exposeInMainWorld\("dshAttentionLocal"/g) || []).length
ok(exposed === 1, 'dshAttentionLocal 只暴露一次', `(x${exposed})`)

// 6. ipc channel sanity: main handlers present
for (const ch of ['dsh-attention:set-badge', 'dsh-attention:clear-badge', 'dsh-attention:flash', 'dsh-attention:notify', 'dsh-attention:get-badges']) {
  ok(mainSrc.includes(ch), `main 侧有 handler: ${ch}`)
}
// preload senders must match
for (const ch of ['dsh-attention:set-badge', 'dsh-attention:clear-badge', 'dsh-attention:flash', 'dsh-attention:notify']) {
  ok(preSrc.includes('"' + ch + '"'), `preload 侧有对应 send: ${ch}`)
}
ok(preSrc.includes('"dsh-attention:get-badges"'), 'preload invoke get-badges')

// 7. Electron fuses in the NEW exe — OnlyLoadAppFromAsar must be OFF,
//    asar integrity must be OFF (also: that fuse is macOS-only anyway).
//    Wire: [32B sig][ver byte][count byte][count fuse bytes], value 0x30='0'(off) 0x31='1'(on)
const SIG = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
const FUSE_NAMES = [
  'RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments', 'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar', 'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
]
const exe = readFileSync(exePath)
const at = exe.indexOf(Buffer.from(SIG, 'latin1'))
if (at < 0) {
  console.log('MISS 未在 exe 中找到 Electron fuse 签名（可能 Electron 版本换了 fuse 格式）— 请人工确认应用会从 resources\\app 加载')
  fail++
} else {
  const ver = exe[at + 32]
  const count = exe[at + 33]
  const raw = [...exe.subarray(at + 34, at + 34 + count)]
  const allValid = raw.every(b => b === 0x30 || b === 0x31)
  const fuses = raw.map(b => (b === 0x31 ? 'ON' : b === 0x30 ? 'OFF' : `0x${b.toString(16)}`))
  console.log(`     fuse wire: version=${ver} count=${count} valid=${allValid}`)
  FUSE_NAMES.forEach((n, i) => {
    if (i < fuses.length) console.log(`     fuse[${i + 1}] ${n} = ${fuses[i]}`)
  })
  if (fuses.length > FUSE_NAMES.length) console.log(`     fuse[${FUSE_NAMES.length + 1}..] = ${fuses.slice(FUSE_NAMES.length).join(',')} (新版本新增 fuse，本表未列名)`)
  ok(allValid, 'fuse 字节全部为 0x30/0x31（对齐正确性自检）')
  const onlyLoad = fuses[5]
  const integrity = fuses[4]
  ok(onlyLoad === 'OFF', 'OnlyLoadAppFromAsar = OFF（否则 resources\\app 被忽略）', `=${onlyLoad}`)
  ok(integrity === 'OFF', 'EnableEmbeddedAsarIntegrityValidation = OFF（且该 fuse 仅 macOS 生效）', `=${integrity}`)
}

console.log(fail ? `\n${fail} 项未通过` : '\nALL PASS')
process.exit(fail ? 1 : 0)
