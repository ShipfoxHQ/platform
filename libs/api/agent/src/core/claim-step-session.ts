import type {Harness} from '@shipfox/api-agent-dto';
import {AgentSessionHarnessMismatchError} from '#core/errors.js';
import {assertValidSessionKey, claimSession, getSessionByRunAttemptAndKey} from '#db/index.js';

/**
 * The resolved session identity handed to workflows dispatch, mirroring the
 * inter-module contract's descriptor: which registry row the step runs
 * against, in which mode, and which head segment it loads (0 = fresh).
 */
export interface StepSessionDescriptor {
  id: string;
  key: string;
  mode: 'resume' | 'fork';
  segment: number;
}

export interface ClaimStepSessionParams {
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  key: string;
  /** Harness resolved for this attempt; an explicit value must match the pinned harness. */
  harness: Harness;
  harnessExplicit: boolean;
  stepAttemptId: string;
  /** `resume` claims exclusively and may write back; `fork` only reads the current head. */
  mode: 'resume' | 'fork';
}

export interface ClaimStepSessionResult {
  /**
   * Null when a `fork` targets a session that does not exist yet: the step
   * runs a fresh ephemeral session and creates nothing.
   */
  descriptor: StepSessionDescriptor | null;
  /** Harness the session is pinned to (the caller's resolved harness when no session exists). */
  harness: Harness;
}

function toDescriptor(
  session: {id: string; key: string; headSegment: number},
  mode: 'resume' | 'fork',
): StepSessionDescriptor {
  return {id: session.id, key: session.key, mode, segment: session.headSegment};
}

/**
 * Workflows-facing seam of the session registry, invoked at step dispatch:
 *
 * * `resume` claims the session exclusively for the attempt (creating it on
 *   first use, pinned to the resolved harness) and returns the current head
 *   segment. Conflicts and harness mismatches fail fast with the domain
 *   errors the presentation maps to contract-known codes.
 * * `fork` performs no claim. It reads whatever head exists within the caller's
 *   workspace/project scope; a fork of a session that does not exist yet
 *   returns a null descriptor and creates nothing. The pinned harness must
 *   match the caller's resolved harness (the same rule resume enforces), so a
 *   fork cannot silently run a provider the workspace's current policy
 *   disallows.
 */
export async function claimStepSession(
  params: ClaimStepSessionParams,
): Promise<ClaimStepSessionResult> {
  assertValidSessionKey(params.key);

  if (params.mode === 'fork') {
    const existingSession = await getSessionByRunAttemptAndKey({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      workflowRunAttemptId: params.workflowRunAttemptId,
      key: params.key,
    });
    if (!existingSession) return {descriptor: null, harness: params.harness};
    if (existingSession.harness !== params.harness) {
      throw new AgentSessionHarnessMismatchError({
        sessionId: existingSession.id,
        workflowRunAttemptId: params.workflowRunAttemptId,
        key: existingSession.key,
        pinnedHarness: existingSession.harness,
        requestedHarness: params.harness,
      });
    }
    return {descriptor: toDescriptor(existingSession, 'fork'), harness: existingSession.harness};
  }

  const session = await claimSession({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    workflowRunAttemptId: params.workflowRunAttemptId,
    key: params.key,
    // claimSession resolves an omitted harness inside the claim transaction,
    // so a concurrent first claim cannot race this selection.
    harness: params.harness,
    harnessExplicit: params.harnessExplicit,
    stepAttemptId: params.stepAttemptId,
  });
  return {descriptor: toDescriptor(session, 'resume'), harness: session.harness};
}
