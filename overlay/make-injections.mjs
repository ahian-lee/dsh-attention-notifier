// make-injections.mjs — generates injections/main-append.txt and
// injections/preload-append.txt from badges/badges-b64.json (10 PNGs).
// v3.1: user said keep it simple — ONE plain white-disc/black-digit set for
//       every state (the colored b1/b2/b3 bundles stay on disk unused). The
//       kind parameter and the dsh-attention:get-badges bridge remain wired,
//       so a future set only needs the KINDS mapping flipped back.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const KEY_LIST = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']
const PLAIN = 'badges-b64.json' // white disc, black digit — approved look
const KINDS = [['alert', PLAIN], ['answer', PLAIN], ['done', PLAIN]]

const bundleMaps = []
for (const [kind, file] of KINDS) {
	const badges = JSON.parse(readFileSync(join(here, 'badges', file), 'utf8'))
	for (const k of KEY_LIST) if (!badges[k]) { console.error(`missing badge ${kind}/${k}`); process.exit(1) }
	// entries are full data:image/png;base64,... strings already
	bundleMaps.push(`"${kind}":{${KEY_LIST.map((k) => `"${k}":${JSON.stringify(badges[k])}`).join(',')}}`)
}
const BADGES_SRC = `{${bundleMaps.join(',')}}`

const MAIN = `
// ==== <dsh-attention-overlay patch v3> ====
// Local shadow-app patch: Windows taskbar overlay digit (3 semantic colors) +
// frame flash + native toasts for the @ahian-lee/dsh-attention-notifier plugin
// (window.dshAttentionLocal bridge via patched preload-app.cjs).
// Rollback: restore-attention-overlay (or patch-app-dir.mjs --revert).
import * as __dshAttnElectron from "electron";
const __dshAttnBadges = ${BADGES_SRC};
const __dshAttnImageCache = new Map();
const __dshAttnOverlayState = new Map();
function __dshAttnImage(kind, n) {
	const label = n > 9 ? "9+" : String(Math.max(1, Math.floor(n) || 1));
	const k = __dshAttnBadges[kind] ? kind : "alert";
	const cacheKey = k + ":" + label;
	let image = __dshAttnImageCache.get(cacheKey);
	if (image === void 0) {
		const data = __dshAttnBadges[k][label];
		image = data ? __dshAttnElectron.nativeImage.createFromDataURL(data) : null;
		if (image && image.isEmpty()) image = null;
		__dshAttnImageCache.set(cacheKey, image);
	}
	return image;
}
function __dshAttnWindow(event) {
	try {
		const fromSender = event ? __dshAttnElectron.BrowserWindow.fromWebContents(event.sender) : null;
		if (fromSender && !fromSender.isDestroyed()) return fromSender;
		return __dshAttnElectron.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible()) ?? null;
	} catch {
		return null;
	}
}
function __dshAttnClearAll() {
	for (const win of __dshAttnElectron.BrowserWindow.getAllWindows()) {
		try {
			if (!win.isDestroyed()) win.setOverlayIcon(null, "");
		} catch {}
	}
	__dshAttnOverlayState.clear();
}
__dshAttnElectron.ipcMain.on("dsh-attention:set-badge", (event, payload) => {
	try {
		const win = __dshAttnWindow(event);
		if (!win) return;
		const p = payload && typeof payload === "object" ? payload : { count: payload };
		const n = Math.max(0, Math.floor(Number(p.count)) || 0);
		const kind = p.kind === "answer" || p.kind === "done" ? p.kind : "alert";
		const label = n === 0 ? "" : n > 9 ? "9+" : String(n);
		const state = kind + ":" + label;
		if (__dshAttnOverlayState.get(win.id) === state) return;
		__dshAttnOverlayState.set(win.id, state);
		if (label === "") win.setOverlayIcon(null, "");
		else {
			const image = __dshAttnImage(kind, n);
			if (image) win.setOverlayIcon(image, n + " sessions need attention");
		}
	} catch (error) {
		console.error("[dsh-attention-overlay] set-badge failed", error);
	}
});
__dshAttnElectron.ipcMain.handle("dsh-attention:get-badges", () => __dshAttnBadges);
__dshAttnElectron.ipcMain.on("dsh-attention:clear-badge", (event) => {
	try {
		const win = __dshAttnWindow(event);
		if (!win) return;
		__dshAttnOverlayState.delete(win.id);
		win.setOverlayIcon(null, "");
	} catch {}
});
__dshAttnElectron.ipcMain.on("dsh-attention:flash", (event, on) => {
	try {
		if (!on) return;
		const win = __dshAttnWindow(event);
		if (win && (win.isMinimized() || !win.isFocused())) win.flashFrame(true);
	} catch {}
});
__dshAttnElectron.ipcMain.on("dsh-attention:notify", (event, payload) => {
	try {
		if (!payload || typeof payload.title !== "string") return;
		const note = new __dshAttnElectron.Notification({
			title: payload.title,
			body: String(payload.body || ""),
			silent: true,
		});
		note.on("click", () => {
			try {
				const win = __dshAttnWindow(event);
				if (win) {
					if (win.isMinimized()) win.restore();
					win.show();
					win.focus();
				}
			} catch {}
		});
		note.show();
	} catch (error) {
		console.error("[dsh-attention-overlay] notify failed", error);
	}
});
__dshAttnElectron.app.on("browser-window-focus", () => {
	// The user is back: the taskbar digit has done its job.
	__dshAttnClearAll();
});
try {
	__dshAttnElectron.app.setAppUserModelId("com.deepseek.dsh");
} catch {}
console.log("[dsh-attention-overlay] patch v3 active");
// ==== </dsh-attention-overlay patch v3> ====
`

const PRELOAD = `
// ==== <dsh-attention-overlay patch v3> ====
try {
	const __dshAttnElectron = require("electron");
	let __dshAttnBadgeCache = null;
	__dshAttnElectron.contextBridge.exposeInMainWorld("dshAttentionLocal", {
		setBadge: (n, kind) => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:set-badge", { count: Number(n) || 0, kind: String(kind || "alert") }) } catch {} },
		clearBadge: () => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:clear-badge") } catch {} },
		flash: (on) => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:flash", !!on) } catch {} },
		notify: (title, body, tag) => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:notify", { title, body, tag }) } catch {} },
		getBadges: async () => {
			if (!__dshAttnBadgeCache) {
				try { __dshAttnBadgeCache = await __dshAttnElectron.ipcRenderer.invoke("dsh-attention:get-badges") } catch { __dshAttnBadgeCache = null }
			}
			return __dshAttnBadgeCache;
		},
	});
	console.log("[dsh-attention-overlay] preload bridge v3 exposed");
} catch (error) {
	try { console.error("[dsh-attention-overlay] preload bridge failed", error) } catch {}
}
// ==== </dsh-attention-overlay patch v3> ====
`

mkdirSync(join(here, 'injections'), { recursive: true })
writeFileSync(join(here, 'injections', 'main-append.txt'), MAIN)
writeFileSync(join(here, 'injections', 'preload-append.txt'), PRELOAD)
console.log('injections written: main-append.txt=' + MAIN.length + 'B preload-append.txt=' + PRELOAD.length + 'B')
