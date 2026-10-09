import assert from 'node:assert/strict'
import { applyAttentionEvent, attentionView, initialAttentionState } from '../fold.js'

const cfg = {}
const fold = (events, state = initialAttentionState()) => events.reduce(applyAttentionEvent, state)
const ev = (type, data) => ({ type, data })

// idle fresh session
{
  const v = attentionView(initialAttentionState(), cfg)
  assert.deepEqual(v, { phase: 'idle', openApprovals: 0, lastEnd: null })
}
// running
assert.equal(attentionView(fold([ev('turn/start', { turn: 1 })]), cfg).phase, 'running')
// approval asked / decided within turn
{
  const asked = fold([
    ev('turn/start', { turn: 1 }),
    ev('approval/asked', { id: 'a1', toolName: 'pwsh' }),
  ])
  const v = attentionView(asked, cfg)
  assert.equal(v.phase, 'waiting-approval')
  assert.equal(v.openApprovals, 1)
  const decided = applyAttentionEvent(asked, ev('approval/decided', { id: 'a1', outcome: 'allowed-once' }))
  assert.equal(attentionView(decided, cfg).phase, 'running')
}
// two stacked approvals
{
  const s = fold([
    ev('turn/start', { turn: 1 }),
    ev('approval/asked', { id: 'a1', toolName: 'pwsh' }),
    ev('approval/asked', { id: 'a2', toolName: 'write' }),
    ev('approval/decided', { id: 'a1', outcome: 'allowed-once' }),
  ])
  assert.equal(attentionView(s, cfg).openApprovals, 1)
}
// completed turn
{
  const s = fold([ev('turn/start', { turn: 3 }), ev('turn/end', { turn: 3, reason: { kind: 'completed' } })])
  assert.deepEqual(attentionView(s, cfg), { phase: 'idle', openApprovals: 0, lastEnd: { turn: 3, kind: 'completed' } })
}
// blocked turn parks on the user
{
  const s = fold([ev('turn/start', { turn: 4 }), ev('turn/end', { turn: 4, reason: { kind: 'blocked' } })])
  assert.equal(attentionView(s, cfg).phase, 'waiting-answer')
}
// stale approval cleared by turn end
{
  const s = fold([
    ev('turn/start', { turn: 5 }),
    ev('approval/asked', { id: 'a9', toolName: 'pwsh' }),
    ev('turn/end', { turn: 5, reason: { kind: 'completed' } }),
  ])
  assert.equal(attentionView(s, cfg).phase, 'idle')
}
// config gating hides kinds
{
  const done = fold([ev('turn/start', { turn: 6 }), ev('turn/end', { turn: 6, reason: { kind: 'completed' } })])
  assert.equal(attentionView(done, { notifyCompletion: false }).lastEnd, null)
  const asked = fold([ev('approval/asked', { id: 'b', toolName: 'x' })])
  assert.equal(attentionView(asked, { notifyApproval: false }).phase, 'idle')
  const blocked = fold([ev('turn/end', { turn: 7, reason: { kind: 'blocked' } })])
  assert.equal(attentionView(blocked, { notifyQuestion: false }).phase, 'idle')
}
// unknown events and missing reason are tolerated; fold stays referentially stable
{
  const base = fold([ev('turn/start', { turn: 8 })])
  assert.equal(applyAttentionEvent(base, ev('assistant/message', {})), base)
  assert.equal(attentionView(fold([ev('turn/end', { turn: 1 })]), cfg).lastEnd.kind, 'other')
}

// ---- ask_user_question: the agent parks on the user, both schemas ----

const askCall = (turn, callId) => ev('tool/call', { turn, step: 1, callId, name: 'ask_user_question', arguments: '{"questions":[{"id":"q","question":"?"}]}' })
const askResult = (callId, content, error) => ev('tool/result', { turn: 1, step: 1, message: { toolCallId: callId, content }, ...(error ? { error } : {}) })
const pendingText = [{ type: 'text', text: '{"pending":true}' }]

// blocking legacy schema: turn stays open on the unresolved call
{
  const s = fold([ev('turn/start', { turn: 9 }), askCall(9, 'c1')])
  assert.equal(attentionView(s, cfg).phase, 'waiting-answer')
}
// timed schema: pending result then the turn parks closed with 'completed'
{
  const s = fold([
    ev('turn/start', { turn: 10 }),
    askCall(10, 'c2'),
    askResult('c2', pendingText),
    ev('step/end', { turn: 10, step: 1 }),
    ev('turn/end', { turn: 10, reason: { kind: 'completed' } }),
  ])
  const v = attentionView(s, cfg)
  assert.equal(v.phase, 'waiting-answer')
  // the parked turn is NOT announced as a completion
  assert.equal(v.lastEnd, null)
}
// the user answers: waiting clears, the completion of the parked turn stays hidden
{
  const parked = fold([
    ev('turn/start', { turn: 11 }),
    askCall(11, 'c3'),
    askResult('c3', pendingText),
    ev('turn/end', { turn: 11, reason: { kind: 'completed' } }),
  ])
  const answered = applyAttentionEvent(parked, ev('user/message', {
    source: { kind: 'user-question-reply', callId: 'c3' },
    content: [{ type: 'text', text: '{"answers":[{"id":"q","selected":["yes"]}]}' }],
  }))
  assert.equal(attentionView(answered, cfg).phase, 'idle')
  assert.deepEqual(answered.openQuestions, [])
}
// resumed by a later turn answering through the tool result
{
  const parked = fold([
    ev('turn/start', { turn: 12 }),
    askCall(12, 'c4'),
    askResult('c4', pendingText),
    ev('turn/end', { turn: 12, reason: { kind: 'completed' } }),
  ])
  const resumed = applyAttentionEvent(parked, askResult('c4', [{ type: 'text', text: '{"answers":[{"id":"q","selected":["yes"]}]}' }]))
  assert.equal(attentionView(resumed, cfg).phase, 'idle')
}
// dismissed (isError result) stops the wait
{
  const s = fold([ev('turn/start', { turn: 13 }), askCall(13, 'c5'), askResult('c5', [{ type: 'text', text: 'user cancelled' }], undefined)])
  assert.equal(attentionView(s, cfg).phase, 'running')
}
// crash repair: TOOL_OUTCOME_UNKNOWN keeps the question answerable
{
  const s = fold([ev('turn/start', { turn: 14 }), askCall(14, 'c6'), askResult('c6', [], { name: 'Error', code: 'TOOL_OUTCOME_UNKNOWN' })])
  assert.equal(attentionView(s, cfg).phase, 'waiting-answer')
}
// PTC sub-call pending from a subagent
{
  const s = fold([
    ev('turn/start', { turn: 15 }),
    ev('tool/ptc-dispatch', { name: 'ask_user_question', subCallId: 'p1', isError: false, content: pendingText, arguments: {} }),
  ])
  assert.equal(attentionView(s, cfg).phase, 'waiting-answer')
}
// other tools' calls and results never touch the question set
{
  const s = fold([
    ev('turn/start', { turn: 16 }),
    ev('tool/call', { turn: 16, step: 1, callId: 'x1', name: 'pwsh', arguments: '{}' }),
    ev('tool/result', { turn: 16, step: 1, message: { toolCallId: 'x1', content: [] } }),
  ])
  assert.equal(attentionView(s, cfg).phase, 'running')
}
// approval outranks an open question; duplicate calls dedupe
{
  const s = fold([
    ev('turn/start', { turn: 17 }),
    askCall(17, 'c7'),
    askCall(17, 'c7'),
    ev('approval/asked', { id: 'a20', toolName: 'pwsh' }),
  ])
  const v = attentionView(s, cfg)
  assert.equal(v.phase, 'waiting-approval')
  assert.equal(s.openQuestions.length, 1)
}
// notifyQuestion off hides asks too
{
  const s = fold([ev('turn/start', { turn: 18 }), askCall(18, 'c8')])
  const v = attentionView(s, { notifyQuestion: false })
  assert.equal(v.phase, 'running')
}
console.log('fold tests: all passed')
