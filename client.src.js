/**
 * Attention Notifier — Client half (Web).
 *
 * Watches the `attention` session projection published by the Host half and, on
 * meaningful transitions while the window is in the background, fires
 *   1. a replaceable attention sound (WebAudio; or an Audio() url override)
 *   2. a silent system toast (Notification; click focuses the window)
 *   3. a Windows taskbar overlay badge on the app icon — ONLY when the desktop
 *      app carries the optional attention-overlay patch (window.dshAttentionLocal).
 *      Deliberately NO in-page badge and no "(N) " title prefix: notifications
 *      stay outside the DSH page (user preference, v0.1.1).
 *
 * Tunables live in TUNABLES below (v0.1: constants; config wiring is the
 * apps/desktop + service-bridge follow-up described in the README).
 *
 * Known API notes: `sessions.list.getSnapshot()` returns { byId: {...} } (verified
 * against shipped client packages); entries are normalized defensively.
 */
window.__ModuleLoader__.load({
  id: '@ahian-lee/dsh-attention-notifier',
  factory(require) {
    // ── Tunables ────────────────────────────────────────────────────────────
    const TUNABLES = {
      /**
       * never | background | always — sound gate. Default "always": when a
       * session needs you, you HEAR it even in the foreground (Codex-style).
       * System toasts stay background-only regardless. "background" = page
       * hidden or unfocused.
       */
      notifyMode: 'always',
      /** Poll interval for the session-list snapshot (ms). */
      pollMs: 1500,
      /** Same (session, kind) transition inside this window is collapsed. */
      dedupeMs: 2000,
      /** Completion bursts beyond this many in burstWindowMs aggregate. */
      aggregateAfter: 4,
      burstWindowMs: 10000,
      /**
       * Replace the synthesized tones with any audio url (https://, file://,
       * data:audio/wav;base64,...). null keeps the built-in WebAudio tone.
       * The tools/gen_sounds.js script exports matching .wav files.
       */
      soundUrls: { done: null, alert: null },
      /** Field-diagnostic smoke test; only staging copies flip this to true. */
      selfTest: false,
      /** Chimes suppressed this long after load: the session store hydrates
       * asynchronously, so "first snapshot" alone cannot cover startup replay. */
      bootGraceMs: 2500,
    }
    // ────────────────────────────────────────────────────────────────────────

    const ZH = /^zh\b/i.test(navigator.language || '')
    const TEXT = {
      approval: ZH ? '等待你的批准' : 'Needs your approval',
      approvalMore: ZH ? (n => `${n} 个会话等待你的批准`) : (n => `${n} sessions need your approval`),
      answer: ZH ? '需要你回答问题' : 'Your answer is needed',
      completed: ZH ? '任务已完成' : 'Task completed',
      completedMany: ZH ? (n => `${n} 个任务已完成`) : (n => `${n} tasks completed`),
      doneTitle: 'DeepSeek Harness',
    }

    // ── Sound engine: preset styles (WebAudio) + user music (IndexedDB) ────
    let audioCtx = null
    /** Synthesized tone styles, selectable in the settings menu.
     *  notes: [freq, seconds, startOffset]; envelope: peak gain + attack. */
    const TONE_STYLES = {
      classic: { label: { zh: '经典', en: 'Classic' }, type: 'sine', peak: 0.32, attack: 0.012,
        done: [[659.25, 0.16, 0], [880, 0.30, 0.17]],
        alert: [[783.99, 0.11, 0], [987.77, 0.11, 0.14], [1318.5, 0.28, 0.28]] },
      soft: { label: { zh: '轻柔', en: 'Soft' }, type: 'sine', peak: 0.18, attack: 0.045,
        done: [[523.25, 0.30, 0], [659.25, 0.55, 0.24]],
        alert: [[659.25, 0.18, 0], [659.25, 0.18, 0.22], [880, 0.45, 0.44]] },
      digital: { label: { zh: '电玩', en: 'Retro' }, type: 'triangle', peak: 0.22, attack: 0.005,
        done: [[784, 0.09, 0], [1046.5, 0.20, 0.10]],
        alert: [[880, 0.07, 0], [880, 0.07, 0.11], [1244.5, 0.18, 0.22]] },
      bell: { label: { zh: '钟铃', en: 'Bell' }, type: 'sine', peak: 0.26, attack: 0.004,
        done: [[1046.5, 0.80, 0]],
        alert: [[1318.5, 0.55, 0], [1318.5, 0.55, 0.4], [1568, 0.9, 0.8]] },
    }
    /** Built-in music, baked at install time by build/gen-builtin-sounds.mjs
     *  (data-URL entries per row). The shipped default is empty, so a stock
     *  npm install simply shows the synthesized styles. */
    const BUILTIN_SOUNDS = /*BUILTIN_DATA*/ { alert: [], done: [] }
    function synthesize(kind, style) {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
      if (audioCtx.state === 'suspended') audioCtx.resume()
      const now = audioCtx.currentTime
      for (const [freq, dur, offset] of style[kind]) {
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = style.type
        osc.frequency.value = freq
        const t0 = now + offset
        gain.gain.setValueAtTime(0.0001, t0)
        gain.gain.exponentialRampToValueAtTime(style.peak, t0 + style.attack)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        osc.connect(gain).connect(audioCtx.destination)
        osc.start(t0)
        osc.stop(t0 + dur + 0.02)
      }
    }
    // ── User preferences (localStorage) + custom music (IndexedDB) ─────────
    const SS_KEY = 'dsh-attn:sounds'
    const DEFAULT_PREF = () => ({
      alert: { mode: 'preset', style: 'classic', id: null, name: null },
      done: { mode: 'preset', style: 'classic', id: null, name: null },
    })
    let soundPrefs = (() => {
      try {
        const raw = JSON.parse(localStorage.getItem(SS_KEY) || 'null')
        if (raw && raw.alert && raw.done) return raw
      } catch {}
      return DEFAULT_PREF()
    })()
    const saveSoundPrefs = () => { try { localStorage.setItem(SS_KEY, JSON.stringify(soundPrefs)) } catch {} }
    let idbPromise = null
    const idb = () => idbPromise || (idbPromise = new Promise((resolve, reject) => {
      try {
        const rq = indexedDB.open('dsh-attn', 1)
        rq.onupgradeneeded = () => { rq.result.createObjectStore('sounds') }
        rq.onsuccess = () => resolve(rq.result)
        rq.onerror = () => reject(rq.error)
      } catch (error) { reject(error) }
    }))
    const idbPut = (id, blob) => idb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('sounds', 'readwrite'); tx.objectStore('sounds').put(blob, id)
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    }))
    const idbGet = (id) => idb().then(db => new Promise((resolve, reject) => {
      const rq = db.transaction('sounds').objectStore('sounds').get(id)
      rq.onsuccess = () => resolve(rq.result || null); rq.onerror = () => reject(rq.error)
    }))
    const idbDel = (id) => idb().then(db => new Promise((resolve) => {
      const tx = db.transaction('sounds', 'readwrite'); tx.objectStore('sounds').delete(id)
      tx.oncomplete = resolve; tx.onerror = resolve
    }))
    const customUrls = new Map() // id -> cached object URL
    async function playTone(kind) {
      try {
        const override = TUNABLES.soundUrls[kind]
        if (override) { new Audio(override).play().catch(() => {}); return }
        const pref = soundPrefs[kind] || DEFAULT_PREF()[kind]
        if (pref.mode === 'builtin' && pref.soundId) {
          const s = (BUILTIN_SOUNDS[kind] || []).find((x) => x.id === pref.soundId)
          if (s) { new Audio(s.url).play().catch(() => {}); return }
        }
        if (pref.mode === 'custom' && pref.id) {
          let url = customUrls.get(pref.id)
          if (!url) {
            const blob = await idbGet(pref.id)
            if (blob) { url = URL.createObjectURL(blob); customUrls.set(pref.id, url) }
          }
          if (url) { new Audio(url).play().catch(() => {}); return }
        }
        synthesize(kind, TONE_STYLES[pref.style] || TONE_STYLES.classic)
      } catch (error) {
        console.warn('[attention-notifier] sound failed', error)
      }
    }
    // Chromium may keep AudioContext suspended until a user gesture; prime it on
    // the first interaction so later background notifications actually make sound.
    const unlockAudio = () => {
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
        if (audioCtx.state === 'suspended') audioCtx.resume()
      } catch {}
    }
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    window.addEventListener('keydown', unlockAudio, { once: true })

    // ── Settings UI: embedded on the official plugins page (More → Settings).
    //    User preference 2026-10-06: NO floating in-app controls; the sound
    //    menu is registered into the plugins.item slot as this plugin's card. ─
    const SS_PANEL = 'dsh-attn-sspanel'
    const MAX_AUDIO = 5 * 1024 * 1024
    const L = {
      title: ZH ? '提示音设置' : 'Notification sounds',
      alertRow: ZH ? '等待处理时' : 'When waiting for you',
      doneRow: ZH ? '任务完成时' : 'When a task finishes',
      preview: ZH ? '试听' : 'Preview',
      pick: ZH ? '选择音乐…' : 'Choose music…',
      resetRow: ZH ? '恢复默认' : 'Use default',
      resetAll: ZH ? '全部恢复默认音色' : 'Reset all sounds',
      tooBig: ZH ? '音频文件请小于 5MB' : 'Audio file must be under 5MB',
      customTag: ZH ? '自定义' : 'Custom',
      styleTag: ZH ? '音色' : 'Style',
    }
    const PANEL_CSS = [
      '.' + SS_PANEL + ' { font-size: 13px; width: 100%; max-width: 480px; }',
      '.' + SS_PANEL + ' .attn-title { font-weight: 600; font-size: 13px; margin-bottom: 10px; opacity: .9; }',
      '.' + SS_PANEL + ' .attn-row { padding: 10px 0; border-top: 0.5px solid rgba(128,128,128,0.25); }',
      '.' + SS_PANEL + ' .attn-row-name { font-weight: 600; margin-bottom: 6px; }',
      '.' + SS_PANEL + ' .attn-styles { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }',
      '.' + SS_PANEL + ' .attn-style, .' + SS_PANEL + ' .attn-act { border: 0.5px solid rgba(128,128,128,0.4); background: rgba(128,128,128,0.12); color: inherit; border-radius: 8px; padding: 4px 11px; font-size: 12px; cursor: pointer; }',
      '.' + SS_PANEL + ' .attn-style:hover, .' + SS_PANEL + ' .attn-act:hover { background: rgba(128,128,128,0.28); }',
      '.' + SS_PANEL + ' .attn-style.sel { outline: 2px solid #4d93f8; background: rgba(77,147,248,0.18); }',
      '.' + SS_PANEL + ' .attn-cur { opacity: .65; font-size: 11px; margin-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 480px; }',
      '.' + SS_PANEL + ' .attn-reset { margin-top: 12px; width: 100%; }',
      '.' + SS_PANEL + ' .attn-file { display: none; }',
    ].join('\n')
    function buildPanel(container) {
      if (container.querySelector('.' + SS_PANEL)) return
      const panel = document.createElement('div')
      panel.className = SS_PANEL
      const rowHtml = (kind, name) => `
        <div class="attn-row" data-kind="${kind}">
          <div class="attn-row-name">${name}</div>
          <div class="attn-styles">${Object.entries(TONE_STYLES).map(([sid, s]) =>
            `<button class="attn-style" data-sid="${sid}">${ZH ? s.label.zh : s.label.en}</button>`).join('')}
          ${(BUILTIN_SOUNDS[kind] || []).map((s) =>
            `<button class="attn-style" data-bid="${s.id}" title="${s.file || ''}">♪ ${s.name}</button>`).join('')}</div>
          <button class="attn-act attn-preview" type="button">▶ ${L.preview}</button>
          <button class="attn-act attn-pick" type="button">${L.pick}</button>
          <input type="file" accept="audio/*" class="attn-file" />
          <div class="attn-cur"></div>
        </div>`
      panel.innerHTML = `<div class="attn-title">${L.title}</div>${rowHtml('alert', L.alertRow)}${rowHtml('done', L.doneRow)}<button class="attn-act attn-reset">${L.resetAll}</button>`
      const rerender = () => {
        for (const row of panel.querySelectorAll('.attn-row')) {
          const kind = row.dataset.kind
          const pref = soundPrefs[kind]
          for (const b of row.querySelectorAll('.attn-style')) {
            const on = b.dataset.sid
              ? pref.mode === 'preset' && (pref.style || 'classic') === b.dataset.sid
              : pref.mode === 'builtin' && pref.soundId === b.dataset.bid
            b.classList.toggle('sel', on)
          }
          row.querySelector('.attn-cur').textContent = pref.mode === 'custom'
            ? `${L.customTag}: ${pref.name || '?'}`
            : pref.mode === 'builtin'
              ? `♪ ${pref.name || pref.soundId || '?'}`
              : `${L.styleTag}: ${(TONE_STYLES[pref.style] || TONE_STYLES.classic).label[ZH ? 'zh' : 'en']}`
        }
      }
      panel.addEventListener('click', async (e) => {
        const row = e.target.closest('.attn-row')
        const kind = row == null ? null : row.dataset.kind
        const pref = kind ? soundPrefs[kind] : null
        if (e.target.classList.contains('attn-style') && kind) {
          if (e.target.dataset.bid) {
            const s = (BUILTIN_SOUNDS[kind] || []).find((x) => x.id === e.target.dataset.bid)
            soundPrefs[kind] = { mode: 'builtin', style: soundPrefs[kind].style || 'classic', soundId: e.target.dataset.bid, name: s ? s.name : e.target.dataset.bid, id: null }
          } else {
            soundPrefs[kind] = { mode: 'preset', style: e.target.dataset.sid, id: null, name: null }
          }
          saveSoundPrefs(); rerender(); playTone(kind)
        } else if (e.target.classList.contains('attn-preview') && kind) {
          playTone(kind)
        } else if (e.target.classList.contains('attn-pick') && kind) {
          row.querySelector('.attn-file').click()
        } else if (e.target.classList.contains('attn-reset-all') || e.target.classList.contains('attn-reset')) {
          const old = Object.values(soundPrefs).map(p => p.mode === 'custom' && p.id).filter(Boolean)
          soundPrefs = DEFAULT_PREF(); saveSoundPrefs(); rerender()
          for (const id of old) { if (id) idbDel(id) }
        }
      })
      panel.addEventListener('change', async (e) => {
        if (!e.target.classList.contains('attn-file')) return
        const kind = e.target.closest('.attn-row').dataset.kind
        const file = e.target.files && e.target.files[0]
        if (!file) return
        if (file.size > MAX_AUDIO) { alert(L.tooBig); return }
        const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        try {
          await idbPut(id, file.slice(0, file.size, file.type || 'audio/mpeg'))
        } catch (error) {
          console.warn('[attention-notifier] store failed', error); return
        }
        const oldId = soundPrefs[kind].id
        if (oldId) idbDel(oldId)
        soundPrefs[kind] = { mode: 'custom', style: soundPrefs[kind].style || 'classic', id, name: file.name }
        saveSoundPrefs(); rerender(); playTone(kind)
      })
      const style = document.createElement('style')
      style.textContent = PANEL_CSS
      container.appendChild(style)
      container.appendChild(panel)
      rerender()
    }
    // ── Official plugins-page card (More → Settings → plugins → this entry) ──
    let React = null
    try { React = require('react') } catch {}
    const summaryLine = () => {
      const nameOf = (kind) => soundPrefs[kind].mode === 'custom'
        ? L.customTag + ': ' + (soundPrefs[kind].name || '?')
        : soundPrefs[kind].mode === 'builtin'
          ? '♪ ' + (soundPrefs[kind].name || '?')
          : (TONE_STYLES[soundPrefs[kind].style] || TONE_STYLES.classic).label[ZH ? 'zh' : 'en']
      return (ZH ? '提示音 — 等待处理：' : 'Sounds — waiting: ') + nameOf('alert')
        + (ZH ? '，完成：' : ', done: ') + nameOf('done')
    }
    function AttentionCard(props) {
      if (!React) return null
      if (props && props.view === 'summary') return React.createElement('span', null, summaryLine())
      return React.createElement('div', {
        ref: (el) => { if (el) { try { buildPanel(el) } catch (error) { console.warn('[attention-notifier] panel mount failed', error) } } },
      })
    }

    // Optional desktop-app bridge for the taskbar overlay badge (see patch kit).
    // Absent (and harmless) when the desktop app has not been patched.
    const overlayBridge = () => {
      try { return typeof window !== 'undefined' ? window.dshAttentionLocal : null } catch { return null }
    }

    // ── Toast ──────────────────────────────────────────────────────────────
    function toast(title, body, tag, sticky) {
      // Prefer the patched desktop bridge: the main-process Electron Notification
      // is far more reliable on Windows than the renderer's HTML5 Notification,
      // which silently no-ops unless permission + AUMID all line up.
      const b = overlayBridge()
      if (b && typeof b.notify === 'function') {
        try { b.notify(title, body, tag); return } catch {}
      }
      try {
        if (typeof Notification === 'undefined') return
        if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
        if (Notification.permission !== 'granted') return
        const note = new Notification(title, { body, tag, silent: true, requireInteraction: !!sticky })
        note.onclick = () => { try { window.focus() } catch {} }
      } catch (error) {
        console.warn('[attention-notifier] toast failed', error)
      }
    }
    const isBackground = () => { try { return !!document.hidden || document.hasFocus() === false } catch { return true } }
    const soundAllowed = () => TUNABLES.notifyMode === 'always'
      || (TUNABLES.notifyMode === 'background' && isBackground())

    // ── Session snapshot normalization (defensive across list shapes) ─────
    function normalizeEntries(snapshot) {
      // Real client API shape (verified against dsh-better-sidebar / dsh-rewind-plugin /
      // dsh-context in the wild): sessions.list.getSnapshot() returns { byId: {...} }.
      const byId = snapshot == null ? void 0 : snapshot.byId
      const raw = Array.isArray(snapshot) ? snapshot
        : Array.isArray(snapshot == null ? void 0 : snapshot.entries) ? snapshot.entries
        : Array.isArray(snapshot == null ? void 0 : snapshot.items) ? snapshot.items
        : byId && typeof byId === 'object'
          ? Object.entries(byId)
              .map(([id, entry]) => (entry && typeof entry === 'object' ? { id, ...entry } : void 0))
              .filter(Boolean)
          : []
      const out = []
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue
        const id = entry.id ?? entry.sessionId
        const values = entry.projectionValues ?? entry.summary?.projectionValues
        const attention = values == null ? void 0 : values.attention
        if (typeof id !== 'string' || !attention || typeof attention !== 'object') continue
        const title = entry.title ?? entry.summary?.title ?? entry.name
          ?? (ZH ? '会话 ' : 'session ') + id.slice(0, 6)
        out.push({ id, title, attention })
      }
      return out
    }

    function createWatcher(ctx) {
      const last = new Map()               // id -> { phase, lastEndTurn }
      const fired = new Map()              // dedupeKey -> timestamp
      const completions = []               // burst window bookkeeping
      const listeners = new Set()
      let waitingTotal = 0
      const bootAt = Date.now()   // startup replay suppressed for bootGraceMs
      let pulseActive = false     // unread completions exist (persists until read)
      let pulseCount = 0          // count of unread completions
      let lastPushed = 0          // last badge value we pushed to the taskbar

      const emit = () => { for (const listener of listeners) listener(waitingTotal) }
      const oncePer = (key) => {
        const now = Date.now()
        if (now - (fired.get(key) ?? 0) < TUNABLES.dedupeMs) return false
        fired.set(key, now)
        return true
      }

      function tick() {
        let entries
        try {
          entries = normalizeEntries(ctx.sessions.list.getSnapshot())
        } catch (error) {
          console.warn('[attention-notifier] snapshot read failed', error)
          return
        }
        const now = Date.now()
        while (completions.length && now - completions[0] > TUNABLES.burstWindowMs) completions.shift()
        const canSound = soundAllowed()
        const canToast = isBackground()
        let waiting = 0, waitingApproval = 0, waitingAnswer = 0
        for (const { id, title, attention } of entries) {
          const prev = last.get(id)
          const cur = { phase: attention.phase ?? 'idle', lastEndTurn: attention.lastEnd?.turn ?? null }
          last.set(id, cur)
          if (attention.phase === 'waiting-approval') { waiting += 1; waitingApproval += 1 }
          else if (attention.phase === 'waiting-answer') { waiting += 1; waitingAnswer += 1 }
          // Startup grace: seed prev-state only, do not replay chimes for
          // situations already pending before the restart. Time-based (not
          // first-snapshot-based): an empty pre-hydration snapshot must not
          // consume the suppression budget.
          if (Date.now() - bootAt < TUNABLES.bootGraceMs) continue
          if (TUNABLES.notifyMode === 'never') continue
          if (attention.phase === 'waiting-approval') {
            if (!prev || prev.phase !== 'waiting-approval') {
              if (oncePer(`${id}:approval`)) {
                if (canSound) playTone('alert')
                if (canToast) toast(TEXT.approval, title, `dsh-${id}-approval`, true)
              }
            }
          } else if (attention.phase === 'waiting-answer') {
            if (!prev || prev.phase !== 'waiting-answer') {
              if (oncePer(`${id}:answer`)) {
                if (canSound) playTone('alert')
                if (canToast) toast(TEXT.answer, title, `dsh-${id}-answer`, true)
              }
            }
          } else if (attention.lastEnd && attention.lastEnd.turn !== (prev?.lastEndTurn ?? null)) {
            const kind = attention.lastEnd.kind
            if (kind === 'completed') {
              if (prev && prev.phase === 'running') {
                if (oncePer(`${id}:done`)) {
                  completions.push(now)
                  pulseActive = true
                  pulseCount += 1
                  if (completions.length > TUNABLES.aggregateAfter) {
                    if (oncePer('aggregate:done')) { if (canSound) playTone('done'); if (canToast) toast(TEXT.doneTitle, TEXT.completedMany(completions.length), 'dsh-aggregate') }
                  } else {
                    if (canSound) playTone('done')
                    if (canToast) toast(TEXT.completed, title, `dsh-${id}-done`)
                  }
                }
              }
            } else if (kind !== 'blocked') {
              if (oncePer(`${id}:end-${kind}`)) {
                if (canSound) playTone('alert')
                if (canToast) toast(`Turn ended: ${kind}`, title, `dsh-${id}-end`)
              }
            }
          }
        }
        const bridge = overlayBridge()
        if (waiting !== waitingTotal) {
          const prev = waitingTotal
          waitingTotal = waiting
          emit()
          // Flash only when attention is genuinely owed (waiting), not for the
          // completion pulse.
          if (prev === 0 && waiting > 0 && bridge) { try { bridge.flash(true) } catch {} }
        }
        // Badge target: sessions awaiting a decision win; otherwise a decaying
        // completion pulse; otherwise clear. The per-tick re-assert is cheap
        // (main de-dupes) and survives the main-side focus clear for waiting.
        // Completion digit PERSISTS until the user opens the window (focus /
        // visibility below), rather than fading on a timer (user preference).
        const target = waiting > 0 ? waiting : (pulseActive ? pulseCount : 0)
        const badgeKind = waitingApproval > 0 ? 'alert' : waitingAnswer > 0 ? 'answer' : 'done'
        if (bridge) {
          try {
            // kind = semantic color (v3 bridge; older bridges ignore it -> red).
            if (target > 0) { bridge.setBadge(target, badgeKind); lastPushed = target }
            else if (lastPushed > 0) { bridge.clearBadge(); lastPushed = 0 }
          } catch {}
        }
      }

      const timer = setInterval(tick, TUNABLES.pollMs)
      // Snapshot subscription gives instant triggers even when hidden-window timer
      // throttling slows the interval to ~1/min; the interval is just a safety net.
      let unsubscribe = null
      try {
        if (typeof ctx.sessions.list.subscribe === 'function') {
          unsubscribe = ctx.sessions.list.subscribe(() => tick())
        }
      } catch (error) {
        console.warn('[attention-notifier] sessions.list.subscribe unavailable', error)
      }
      tick()
      // Coming back to the window (focus OR becoming visible) means the completions
      // were seen: mark read so the persistent digit clears and does NOT re-assert
      // when throttled timers resume after restore.
      const clearPulse = () => { pulseActive = false; pulseCount = 0 }
      const onVisible = () => { if (!document.hidden) clearPulse() }
      window.addEventListener('focus', clearPulse)
      document.addEventListener('visibilitychange', onVisible)
      // One-shot plumbing smoke test: proves preload bridge + setOverlayIcon +
      // audio without depending on real waiting events. Staged copies only.
      if (TUNABLES.selfTest) {
        setTimeout(() => {
          const b = overlayBridge()
          console.log('[attention-notifier] selftest bridge=' + !!b)
          if (!b) return
          try {
            playTone('alert')
            b.setBadge(1, 'alert')
            setTimeout(() => { try { b.clearBadge() } catch {} }, 5000)
          } catch (error) { console.warn('[attention-notifier] selftest failed', error) }
        }, 2500)
      }
      return {
        dispose: () => { clearInterval(timer); window.removeEventListener('focus', clearPulse); document.removeEventListener('visibilitychange', onVisible); try { unsubscribe?.() } catch {} },
        subscribe: (listener) => { listeners.add(listener); listener(waitingTotal); return () => listeners.delete(listener) },
        getWaiting: () => waitingTotal,
      }
    }

    return {
      inject: ['sessions', 'slots'],
      apply(ctx) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {})
        }
        // Sound settings live on the OFFICIAL plugins page (More → Settings →
        // plugins → Attention Notifier), registered through the documented
        // plugins.item slot — never as floating in-app UI (user preference).
        if (React && ctx.slots && typeof ctx.slots.inject === 'function') {
          try {
            ctx.slots.inject('plugins.item', () => ctx.slots.register(
              { name: 'plugins.item', id: 'attention', order: 42, label: 'Attention Notifier' },
              AttentionCard
            ))
          } catch (error) { console.warn('[attention-notifier] settings slot unavailable', error) }
        }
        const watcher = createWatcher(ctx)
        ctx.effect(() => () => watcher.dispose())
      },
    }
  },
})
