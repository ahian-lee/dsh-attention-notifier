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
// ==== <dsh-attention-overlay patch v4> ====
// Local shadow-app patch: Windows taskbar overlay digit + persistent "hot"
// blinking + native toasts for the @ahian-lee/dsh-attention-notifier plugin
// (window.dshAttentionLocal bridge via patched preload-app.cjs).
// Rollback: restore-attention-overlay (or patch-app-dir.mjs --revert).
import * as __dshAttnElectron from "electron";
const __dshAttnBadges = ${BADGES_SRC};
const __dshAttnImageCache = new Map();
const __dshAttnOverlayState = new Map();
// Persistent blink ("hot" taskbar state) while attention is owed.
const __dshAttnBlink = new Map();   // win.id -> { timer, on, image, tooltip }
const BLINK_MS = 700;
const FLASH_REARM_MS = 3000;        // Windows may stop the native flash on its own: re-arm it periodically
function __dshAttnStopBlink(winId) {
	const b = __dshAttnBlink.get(winId);
	if (!b) return;
	try { clearInterval(b.timer) } catch {}
	// restore the solid overlay so the digit is never left half-painted
	try {
		const win = __dshAttnElectron.BrowserWindow.fromId(winId);
		if (win && !win.isDestroyed()) win.setOverlayIcon(b.image, b.tooltip);
	} catch {}
	__dshAttnBlink.delete(winId);
}
function __dshAttnStartBlink(win) {
	if (!win || win.isDestroyed()) return;
	const state = __dshAttnOverlayState.get(win.id);
	if (!state || state.endsWith(":")) return;      // nothing to show
	const [kind, label] = state.split(":");
	const n = label === "9+" ? 10 : Number(label) || 0;
	const image = __dshAttnImage(kind, n);
	if (!image) return;
	const tooltip = (label === "9+" ? "9+" : String(n)) + " sessions need attention";
	if (__dshAttnBlink.has(win.id)) return;         // already blinking
	let on = true;
	let lastFlash = 0;
	const timer = setInterval(() => {
		try {
			const w = __dshAttnElectron.BrowserWindow.fromId(win.id);
			if (!w || w.isDestroyed()) { __dshAttnStopBlink(win.id); return }
			on = !on;
			w.setOverlayIcon(on ? image : null, on ? tooltip : "");
			// Keep the native taskbar highlight alive too (Windows may drop it).
			const now = Date.now();
			if (now - lastFlash > FLASH_REARM_MS && (w.isMinimized() || !w.isFocused())) {
				lastFlash = now;
				try { w.flashFrame(true) } catch {}
			}
		} catch { __dshAttnStopBlink(win.id) }
	}, BLINK_MS);
	__dshAttnBlink.set(win.id, { timer, on, image, tooltip });
}
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
		const changed = __dshAttnOverlayState.get(win.id) !== state;
		__dshAttnOverlayState.set(win.id, state);
		if (label === "") {
			__dshAttnStopBlink(win.id);
			win.setOverlayIcon(null, "");
			return;
		}
		// "hot" kinds blink; completion (done) stays solid (user preference).
		// The client re-asserts the badge every poll, so this is a self-healing
		// keep-alive: if the blink died for any reason, it restarts here.
		const hot = kind === "alert" || kind === "answer";
		if (!hot) __dshAttnStopBlink(win.id);
		if (hot) {
			__dshAttnStartBlink(win);
			// Native highlight: arm immediately when the window is not in front.
			if (win.isMinimized() || !win.isFocused()) { try { win.flashFrame(true) } catch {} }
		} else {
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
		__dshAttnStopBlink(win.id);
		__dshAttnOverlayState.delete(win.id);
		win.setOverlayIcon(null, "");
		try { win.flashFrame(false) } catch {}
	} catch {}
});
__dshAttnElectron.ipcMain.on("dsh-attention:flash", (event, on) => {
	try {
		const win = __dshAttnWindow(event);
		if (!win) return;
		if (on) {
			// Native taskbar flash (Windows "hot" highlight) + the overlay blink.
			if (win.isMinimized() || !win.isFocused()) win.flashFrame(true);
			__dshAttnStartBlink(win);
		} else {
			try { win.flashFrame(false) } catch {}
			__dshAttnStopBlink(win.id);
		}
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
	// The user is back: stop blinking and drop the taskbar digit.
	for (const win of __dshAttnElectron.BrowserWindow.getAllWindows()) {
		try { if (!win.isDestroyed()) win.flashFrame(false) } catch {}
	}
	__dshAttnClearAll();
});
try {
	__dshAttnElectron.app.setAppUserModelId("com.deepseek.dsh");
} catch {}
console.log("[dsh-attention-overlay] patch v4 active (blink enabled)");
// ==== </dsh-attention-overlay patch v4> ====
`

const PRELOAD = `
// ==== <dsh-attention-overlay patch v4> ====
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
	console.log("[dsh-attention-overlay] preload bridge v4 exposed");
} catch (error) {
	try { console.error("[dsh-attention-overlay] preload bridge failed", error) } catch {}
}
// ==== </dsh-attention-overlay patch v4> ====
`

mkdirSync(join(here, 'injections'), { recursive: true })
writeFileSync(join(here, 'injections', 'main-append.txt'), MAIN)
writeFileSync(join(here, 'injections', 'preload-append.txt'), PRELOAD)
console.log('injections written: main-append.txt=' + MAIN.length + 'B preload-append.txt=' + PRELOAD.length + 'B')
