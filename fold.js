/**
 * Pure fold + view derivation for the `attention` session projection.
 * Zero imports so it can be unit-tested outside a Harness profile.
 *
 * @module @local/dsh-attention-notifier/fold
 */

/** @returns initial fold state. */
export const initialAttentionState = () => ({ openTurn: false, pendingApprovals: [], lastEnd: null })

/**
 * Pure, synchronous fold over session events. Same reference for ignored events.
 * @param state - current state
 * @param event - one session event ({ type, data })
 */
export function applyAttentionEvent(state, event) {
  switch (event.type) {
    case 'turn/start':
      return state.openTurn && state.lastEnd === null ? state : { ...state, openTurn: true, lastEnd: null }
    case 'approval/asked': {
      const id = event.data.id
      if (state.pendingApprovals.some(item => item.id === id)) return state
      const toolName = typeof event.data.toolName === 'string' ? event.data.toolName : ''
      return { ...state, pendingApprovals: [...state.pendingApprovals, { id, toolName }] }
    }
    case 'approval/decided': {
      const kept = state.pendingApprovals.filter(item => item.id !== event.data.id)
      return kept.length === state.pendingApprovals.length ? state : { ...state, pendingApprovals: kept }
    }
    case 'turn/end': {
      const kind = typeof event.data.reason?.kind === 'string' ? event.data.reason.kind : 'other'
      return { openTurn: false, pendingApprovals: [], lastEnd: { turn: event.data.turn, kind } }
    }
    default:
      return state
  }
}

/**
 * Derive the wire view; config gates which kinds the Client may see.
 * @param state - fold state
 * @param config - plugin row config
 */
export function attentionView(state, config) {
  let phase = 'idle'
  let openApprovals = 0
  if (config.notifyApproval !== false && state.pendingApprovals.length > 0) {
    phase = 'waiting-approval'
    openApprovals = state.pendingApprovals.length
  } else if (state.openTurn) {
    phase = 'running'
  } else if (state.lastEnd && config.notifyQuestion !== false && state.lastEnd.kind === 'blocked') {
    phase = 'waiting-answer'
  }
  let lastEnd = state.lastEnd
  if (lastEnd) {
    const kindOk = lastEnd.kind === 'completed'
      ? config.notifyCompletion !== false
      : config.notifyFailedTurn !== false
    if (!kindOk) lastEnd = null
  }
  return { phase, openApprovals, lastEnd }
}
