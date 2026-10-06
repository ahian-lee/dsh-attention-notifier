// make-injections.mjs — generates injections/main-append.txt and
// injections/preload-append.txt from badges/badges-b64.json (10 PNGs).
// v2: adds dsh-attention:notify (native main-process toasts) to the bridge.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const badges = JSON.parse(readFileSync(join(here, 'badges', 'badges-b64.json'), 'utf8'))
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']
for (const k of keys) if (!badges[k]) { console.error('missing badge ' + k); process.exit(1) }
const badgeMap = '{' + keys.map((k) => `"${k}":"${badges[k]}"`).join(',') + '}'

const MAIN = `
// ==== <dsh-attention-overlay patch v2> ====
// Local shadow-app patch: Windows taskbar overlay digit + frame flash + native
// toasts for the @ahian-lee/dsh-attention-notifier plugin (window.dshAttentionLocal
// bridge via patched preload-app.cjs). Rollback: rollback-attention-overlay.cmd
import * as __dshAttnElectron from "electron";
const __dshAttnBadges = ${badgeMap};
const __dshAttnImageCache = new Map();
const __dshAttnOverlayState = new Map();
function __dshAttnImage(n) {
	const label = n > 9 ? "9+" : String(Math.max(1, Math.floor(n) || 1));
	let image = __dshAttnImageCache.get(label);
	if (image === void 0) {
		const data = __dshAttnBadges[label];
		image = data ? __dshAttnElectron.nativeImage.createFromDataURL("data:image/png;base64," + data) : null;
		if (image && image.isEmpty()) image = null;
		__dshAttnImageCache.set(label, image);
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
__dshAttnElectron.ipcMain.on("dsh-attention:set-badge", (event, count) => {
	try {
		const win = __dshAttnWindow(event);
		if (!win) return;
		const n = Math.max(0, Math.floor(Number(count)) || 0);
		const label = n === 0 ? "" : n > 9 ? "9+" : String(n);
		if (__dshAttnOverlayState.get(win.id) === label) return;
		__dshAttnOverlayState.set(win.id, label);
		if (label === "") win.setOverlayIcon(null, "");
		else {
			const image = __dshAttnImage(n);
			if (image) win.setOverlayIcon(image, n + " sessions need attention");
		}
	} catch (error) {
		console.error("[dsh-attention-overlay] set-badge failed", error);
	}
});
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
console.log("[dsh-attention-overlay] patch v2 active");
// ==== </dsh-attention-overlay patch v2> ====
`

const PRELOAD = `
// ==== <dsh-attention-overlay patch v2> ====
try {
	const __dshAttnElectron = require("electron");
	__dshAttnElectron.contextBridge.exposeInMainWorld("dshAttentionLocal", {
		setBadge: (n) => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:set-badge", Number(n) || 0) } catch {} },
		clearBadge: () => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:clear-badge") } catch {} },
		flash: (on) => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:flash", !!on) } catch {} },
		notify: (title, body, tag) => { try { __dshAttnElectron.ipcRenderer.send("dsh-attention:notify", { title, body, tag }) } catch {} },
	});
	console.log("[dsh-attention-overlay] preload bridge exposed");
} catch (error) {
	try { console.error("[dsh-attention-overlay] preload bridge failed", error) } catch {}
}
// ==== </dsh-attention-overlay patch v2> ====
`

mkdirSync(join(here, 'injections'), { recursive: true })
writeFileSync(join(here, 'injections', 'main-append.txt'), MAIN)
writeFileSync(join(here, 'injections', 'preload-append.txt'), PRELOAD)
console.log('injections written: main-append.txt=' + MAIN.length + 'B preload-append.txt=' + PRELOAD.length + 'B')
