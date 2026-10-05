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
console.log('fold tests: all passed')
