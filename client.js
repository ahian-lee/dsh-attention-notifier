/**
 * Attention Notifier — Client half (Web).
 *
 * Watches the `attention` session projection published by the Host half and, on
 * meaningful transitions while the window is in the background, fires
 *   1. a replaceable attention sound (WebAudio; or an Audio() url override)
 *   2. a silent system toast (Notification; click focuses the window)
 *   3. an in-app waiting badge (composer dock) + "(N) " document.title prefix
 *
 * Tunables live in TUNABLES below (v0.1: constants; config wiring is the
 * apps/desktop + service-bridge follow-up described in the README).
 *
 * Known API notes: `sessions.list.getSnapshot()` and the composer dock slot are
 * observed from shipped client packages; entries are normalized defensively.
 */
window.__ModuleLoader__.load({
  id: '@ahian-lee/dsh-attention-notifier',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ── Tunables ────────────────────────────────────────────────────────────
    const TUNABLES = {
      /** never | background | always — "background" = page hidden or unfocused. */
      notifyMode: 'background',
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

    // ── Toast ──────────────────────────────────────────────────────────────
    function toast(title, body, tag, sticky) {
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
    const inBackground = () => TUNABLES.notifyMode === 'always'
      || (TUNABLES.notifyMode === 'background' && (document.hidden || !document.hasFocus()))

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
        let waiting = 0
        for (const { id, title, attention } of entries) {
          const prev = last.get(id)
          const cur = { phase: attention.phase ?? 'idle', lastEndTurn: attention.lastEnd?.turn ?? null }
          last.set(id, cur)
          if (attention.phase === 'waiting-approval' || attention.phase === 'waiting-answer') waiting += 1
          if (!inBackground()) continue
          if (attention.phase === 'waiting-approval') {
            if (!prev || prev.phase !== 'waiting-approval') {
              if (oncePer(`${id}:approval`)) {
                playTone('alert')
                toast(TEXT.approval, title, `dsh-${id}-approval`, true)
              }
            }
          } else if (attention.phase === 'waiting-answer') {
            if (!prev || prev.phase !== 'waiting-answer') {
              if (oncePer(`${id}:answer`)) {
                playTone('alert')
                toast(TEXT.answer, title, `dsh-${id}-answer`, true)
              }
            }
          } else if (attention.lastEnd && attention.lastEnd.turn !== (prev?.lastEndTurn ?? null)) {
            const kind = attention.lastEnd.kind
            if (kind === 'completed') {
              if (prev && prev.phase === 'running') {
                if (oncePer(`${id}:done`)) {
                  completions.push(now)
                  if (completions.length > TUNABLES.aggregateAfter) {
                    if (oncePer('aggregate:done')) { playTone('done'); toast(TEXT.doneTitle, TEXT.completedMany(completions.length), 'dsh-aggregate') }
                  } else {
                    playTone('done')
                    toast(TEXT.completed, title, `dsh-${id}-done`)
                  }
                }
              }
            } else if (kind !== 'blocked') {
              if (oncePer(`${id}:end-${kind}`)) {
                playTone('alert')
                toast(`Turn ended: ${kind}`, title, `dsh-${id}-end`)
              }
            }
          }
        }
        if (waiting !== waitingTotal) { waitingTotal = waiting; emit() }
      }

      const timer = setInterval(tick, TUNABLES.pollMs)
      tick()
      const originalTitle = document.title
      const titleTimer = setInterval(() => {
        const want = waitingTotal > 0 ? `(${waitingTotal}) ${originalTitle}` : originalTitle
        if (document.title !== want) document.title = want
      }, 2000)
      return {
        dispose: () => { clearInterval(timer); clearInterval(titleTimer) },
        subscribe: (listener) => { listeners.add(listener); listener(waitingTotal); return () => listeners.delete(listener) },
        getWaiting: () => waitingTotal,
      }
    }

    function Badge({ watcher }) {
      const waiting = React.useSyncExternalStore(watcher.subscribe, watcher.getWaiting)
      if (!waiting) return null
      return h('span', {
        title: TEXT.approval,
        'aria-label': `${waiting} ${TEXT.approval}`,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
          borderRadius: 999, background: 'var(--dsw-alias-accent, #247bbf)', color: '#fff',
          fontSize: 12, lineHeight: '18px', cursor: 'default', userSelect: 'none',
        },
      }, '●', String(waiting))
    }

    return {
      inject: ['sessions', 'slots'],
      apply(ctx) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {})
        }
        const watcher = createWatcher(ctx)
        ctx.effect(() => () => watcher.dispose())
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'attention-badge', order: 50,
        }, () => h(Badge, { watcher })))
      },
    }
  },
})
