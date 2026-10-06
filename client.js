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

    // ── Sound: WebAudio synthesis with optional url override ───────────────
    let audioCtx = null
    const TONES = {
      // [freq, seconds, startOffset, gap handled by start times]
      done: [[659.25, 0.16, 0], [880, 0.30, 0.17]],
      alert: [[783.99, 0.11, 0], [987.77, 0.11, 0.14], [1318.5, 0.28, 0.28]],
    }
    function playTone(kind) {
      try {
        const override = TUNABLES.soundUrls[kind]
        if (override) { new Audio(override).play().catch(() => {}) ; return }
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
        if (audioCtx.state === 'suspended') audioCtx.resume()
        const now = audioCtx.currentTime
        for (const [freq, dur, offset] of TONES[kind]) {
          const osc = audioCtx.createOscillator()
          const gain = audioCtx.createGain()
          osc.type = 'sine'
          osc.frequency.value = freq
          const t0 = now + offset
          gain.gain.setValueAtTime(0.0001, t0)
          gain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.012)
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
          osc.connect(gain).connect(audioCtx.destination)
          osc.start(t0)
          osc.stop(t0 + dur + 0.02)
        }
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
        let waiting = 0
        for (const { id, title, attention } of entries) {
          const prev = last.get(id)
          const cur = { phase: attention.phase ?? 'idle', lastEndTurn: attention.lastEnd?.turn ?? null }
          last.set(id, cur)
          if (attention.phase === 'waiting-approval' || attention.phase === 'waiting-answer') waiting += 1
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
        if (bridge) {
          try {
            if (target > 0) { bridge.setBadge(target); lastPushed = target }
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
            b.setBadge(1)
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
      inject: ['sessions'],
      apply(ctx) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {})
        }
        const watcher = createWatcher(ctx)
        ctx.effect(() => () => watcher.dispose())
      },
    }
  },
})
