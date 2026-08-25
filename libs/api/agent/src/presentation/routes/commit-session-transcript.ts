import {
  commitSessionTranscriptQuerySchema,
  commitSessionTranscriptResponseSchema,
  SESSION_TRANSCRIPT_MODEL_HEADER,
  SESSION_TRANSCRIPT_PROVIDER_HEADER,
  SESSION_TRANSCRIPT_SDK_VERSION_HEADER,
  sessionCommitConflictResponseSchema,
} from '@shipfox/api-agent-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {SegmentManifest} from '#core/session-artifacts/manifest.js';
import type {SessionArtifactStore} from '#core/session-artifacts/store.js';
import {resolveLeasedSessionForStep, toSessionTranscriptRouteError} from './session-transcript.js';

/**
 * Reads the runner-reported manifest inputs from the commit request headers.
 * The harness is never caller-supplied: the session row's pinned harness is
 * authoritative (a transcript is byte-exact for the harness that produced it).
 */
function manifestFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  pinnedHarness: SegmentManifest['harness'],
  committedByStepAttempt: string,
): SegmentManifest {
  const readHeader = (name: string): string => {
    const value = headers[name];
    if (typeof value !== 'string' || value === '') {
      throw new ClientError(`Missing session manifest header: ${name}`, 'missing-manifest-header', {
        status: 400,
      });
    }
    return value;
  };

  return {
    harness: pinnedHarness,
    sdkVersion: readHeader(SESSION_TRANSCRIPT_SDK_VERSION_HEADER),
    model: readHeader(SESSION_TRANSCRIPT_MODEL_HEADER),
    provider: readHeader(SESSION_TRANSCRIPT_PROVIDER_HEADER),
    committedByStepAttempt,
  };
}

export function createCommitSessionTranscriptRoute(params: {
  workflows: WorkflowsModuleClient;
  store: SessionArtifactStore;
}) {
  return defineRoute({
    method: 'POST',
    path: '/steps/:stepId/session',
    description:
      'Commits the leased agent step session transcript: the body is the gzipped harness session file. The commit applies only when the calling attempt holds the claim and base_segment equals the current head; the server then writes segment base_segment + 1 and flips the head. A retried POST of an already-landed commit is acked without rewriting; every other combination is a 409. The platform blob cap is enforced here.',
    schema: {
      params: z.object({stepId: z.string().uuid()}),
      querystring: commitSessionTranscriptQuerySchema,
      response: {
        200: commitSessionTranscriptResponseSchema,
        409: sessionCommitConflictResponseSchema,
      },
    },
    errorHandler: (error) => toSessionTranscriptRouteError(error),
    handler: async (request) => {
      const {stepId} = request.params;
      const {attempt, base_segment} = request.query;
      const {context, session} = await resolveLeasedSessionForStep({
        workflows: params.workflows,
        request,
        stepId,
        attempt,
      });

      const result = await params.store.commitSegment({
        session,
        stepAttemptId: context.stepAttemptId,
        baseSegment: base_segment,
        blob: (request.body as Buffer | undefined) ?? Buffer.alloc(0),
        manifest: manifestFromHeaders(
          request.headers as Record<string, string | string[] | undefined>,
          session.harness,
          context.stepAttemptId,
        ),
        headRepoRef: null,
      });

      if (result.outcome === 'conflict') {
        throw new ClientError(
          'Session commit conflict: the caller does not hold the claim or the base segment is stale',
          'session-commit-conflict',
          {
            status: 409,
            details: {head_segment: result.session?.headSegment ?? 0},
          },
        );
      }

      return {status: result.outcome, segment: base_segment + 1};
    },
  });
}
