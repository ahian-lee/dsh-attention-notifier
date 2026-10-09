/**
 * Pure fold + view derivation for the `attention` session projection.
 * Zero imports so it can be unit-tested outside a Harness profile.
 *
 * The agent parking on the user happens in three shapes, all tracked here:
 *   1. `approval/asked` without its `approval/decided`  → waiting-approval
 *   2. an `ask_user_question` call still awaiting its answer → waiting-answer
 *      (both the timed schema, whose pending result lets the turn end with
 *      `completed` while the question stays open, and the blocking legacy
 *      schema, whose turn stays open on the unresolved tool call)
 *   3. `turn/end` with `reason.kind === 'blocked'` (pre-step hook parked) → waiting-answer
 *
 * Question vocabulary verified against @deepseek-ai/dsh-user-questions
 * (types/projection.js, stateVersion 2): tool/call {name, callId, arguments},
 * pending tool/result carries a text block parsing to {pending: true}, a
 * resumed call closes with error.code TOOL_OUTCOME_UNKNOWN, the user's reply
 * is a user/message with source.kind 'user-question-reply' + source.callId,
 * and PTC sub-calls arrive as tool/ptc-dispatch {name, subCallId, content}.
 * Unlike the official `userQuestions` projection we also track the blocking
 * legacy schema: for attention purposes a parked tool call is the signal.
 *
 * @module @local/dsh-attention-notifier/fold
 */

const ASK_TOOL = 'ask_user_question'
const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN'

/** @returns initial fold state. */
export const initialAttentionState = () => ({
  openTurn: false,
  pendingApprovals: [],
  openQuestions: [],
  lastEnd: null,
})

/** Whether one tool result content is the timed ask's pending payload. */
function isPendingResult(content) {
  if (!Array.isArray(content)) return false
  const text = content.find(block => block && block.type === 'text')
  if (text === undefined || typeof text.text !== 'string') return false
  try {
    const parsed = JSON.parse(text.text)
    return typeof parsed === 'object' && parsed !== null && parsed.pending === true
  } catch {
    return false
  }
}

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
    case 'tool/call': {
      if (event.data.name !== ASK_TOOL) return state
      const callId = event.data.callId
      if (typeof callId !== 'string' || state.openQuestions.some(item => item.callId === callId)) return state
      return { ...state, openQuestions: [...state.openQuestions, { callId }] }
    }
    case 'tool/result': {
      const callId = event.data.message?.toolCallId
      if (!state.openQuestions.some(item => item.callId === callId)) return state
      // Pending payload or an unknown-outcome repair: the question stays answerable.
      if (isPendingResult(event.data.message?.content) || event.data.error?.code === TOOL_OUTCOME_UNKNOWN) return state
      // Answered, dismissed or failed: the agent is unblocked either way.
      const openQuestions = state.openQuestions.filter(item => item.callId !== callId)
      return { ...state, openQuestions }
    }
    case 'tool/ptc-dispatch': {
      if (event.data.name !== ASK_TOOL || event.data.isError || !isPendingResult(event.data.content)) return state
      const callId = event.data.subCallId
      if (typeof callId !== 'string' || state.openQuestions.some(item => item.callId === callId)) return state
      return { ...state, openQuestions: [...state.openQuestions, { callId }] }
    }
    case 'user/message': {
      const callId = event.data.source?.kind === 'user-question-reply' ? event.data.source.callId : undefined
      if (typeof callId !== 'string' || !state.openQuestions.some(item => item.callId === callId)) return state
      return { ...state, openQuestions: state.openQuestions.filter(item => item.callId !== callId) }
    }
    case 'turn/end': {
      const kind = typeof event.data.reason?.kind === 'string' ? event.data.reason.kind : 'other'
      // Open questions survive the turn end: the timed ask lets the turn close
      // while the user's answer is still owed; clearing approvals stays as is.
      return { ...state, openTurn: false, pendingApprovals: [], lastEnd: { turn: event.data.turn, kind } }
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
  const waitingQuestion = config.notifyQuestion !== false && state.openQuestions.length > 0
  if (config.notifyApproval !== false && state.pendingApprovals.length > 0) {
    phase = 'waiting-approval'
    openApprovals = state.pendingApprovals.length
  } else if (waitingQuestion) {
    // The agent asked the user something; whether the turn is still open
    // (blocking schema) or already parked closed (timed schema) is irrelevant.
    phase = 'waiting-answer'
  } else if (state.openTurn) {
    phase = 'running'
  } else if (state.lastEnd && config.notifyQuestion !== false && state.lastEnd.kind === 'blocked') {
    phase = 'waiting-answer'
  }
  let lastEnd = state.lastEnd
  if (lastEnd) {
    // A turn that ended while a question is owed is not a completion.
    if (waitingQuestion) lastEnd = null
    else {
      const kindOk = lastEnd.kind === 'completed'
        ? config.notifyCompletion !== false
        : config.notifyFailedTurn !== false
      if (!kindOk) lastEnd = null
    }
  }
  return { phase, openApprovals, lastEnd }
}
