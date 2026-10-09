/**
 * Attention Notifier — Host half.
 *
 * Registers the `attention` session projection that folds the durable log into a
 * tiny per-session state the Client uses to decide notifications:
 *
 *   waiting-approval  an `approval/asked` without its `approval/decided` pair
 *   waiting-answer    an `ask_user_question` still awaiting the user's answer
 *                     (timed or blocking schema), or `turn/end` with
 *                     `reason.kind === 'blocked'` (agent parked on the user)
 *   running           an open turn (`turn/start` not yet closed)
 *   idle              turn closed; `lastEnd.kind` tells `completed` from other ends
 *
 * Event vocabulary is the canonical SessionEventMap shipped with dsh
 * (verified against @deepseek-ai/dsh-user-approval, dsh-agent-loop append site,
 * and dsh-session known-event-types):
 *   turn/start {turn} / turn/end {turn, reason:{kind}}
 *   approval/asked {id, toolName, callId?, reason?} / approval/decided {id, outcome}
 *
 * The fold itself lives in ./fold.js (zero imports, unit-tested by test/fold.test.js).
 * The Config gates what the wire view exposes, so turning a kind off means the
 * Client never sees it. User-tunable in the profile's cordis.patch.yml row.
 *
 * @module @local/dsh-attention-notifier
 */
// Dual schema layers (verified against v44.0.0 app.asar, e.g. dsh-session's
// turnBoundaryProjectionDefinition): projection stateSchema/viewSchema are
// zod, while plugin Config is schemastery (cordis config layer).
import schemastery from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { applyAttentionEvent, attentionView, initialAttentionState } from './fold.js'

const approvalItem = z.object({
  id: z.string(),
  toolName: z.string(),
}).strict()

const questionItem = z.object({
  callId: z.string(),
}).strict()

const stateSchema = z.object({
  openTurn: z.boolean(),
  pendingApprovals: z.array(approvalItem),
  openQuestions: z.array(questionItem),
  lastEnd: z.object({
    turn: z.number().int().nonnegative(),
    kind: z.string(),
  }).nullable(),
}).strict()

const viewSchema = z.object({
  phase: z.enum(['idle', 'running', 'waiting-approval', 'waiting-answer']),
  openApprovals: z.number().int().nonnegative(),
  lastEnd: z.object({ turn: z.number(), kind: z.string() }).nullable(),
}).strict()

/**
 * Build the projection definition gated by the plugin config.
 * @param config - resolved row config from cordis.patch.yml
 */
export function makeAttentionProjection(config) {
  return {
    key: 'attention',
    stateSchema,
    init: () => initialAttentionState(),
    /** Pure, synchronous fold. Returns the same reference for ignored events. */
    apply: (state, event) => applyAttentionEvent(state, event),
    wire: { viewSchema, view: state => attentionView(state, config) },
    stateVersion: 2,
  }
}

export const inject = ['sessionProjections']

export const Config = schemastery.object({
  notifyApproval: schemastery.boolean().default(true),
  notifyQuestion: schemastery.boolean().default(true),
  notifyCompletion: schemastery.boolean().default(true),
  notifyFailedTurn: schemastery.boolean().default(true),
})

export function apply(ctx, config) {
  ctx.sessionProjections.register(makeAttentionProjection(config))
}
