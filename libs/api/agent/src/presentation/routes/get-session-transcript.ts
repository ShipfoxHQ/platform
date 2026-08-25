import {
  SESSION_TRANSCRIPT_CONTENT_TYPE,
  SESSION_TRANSCRIPT_HARNESS_HEADER,
  SESSION_TRANSCRIPT_HARNESS_SESSION_ID_HEADER,
  SESSION_TRANSCRIPT_SEGMENT_HEADER,
  sessionTranscriptQuerySchema,
} from '@shipfox/api-agent-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {SessionArtifactStore} from '#core/session-artifacts/store.js';
import {resolveLeasedSessionForStep, toSessionTranscriptRouteError} from './session-transcript.js';

export function createGetSessionTranscriptRoute(params: {
  workflows: WorkflowsModuleClient;
  store: SessionArtifactStore;
}) {
  return defineRoute({
    method: 'GET',
    path: '/steps/:stepId/session',
    description:
      'Returns the decrypted, still-gzipped head snapshot of the leased agent step session transcript, with manifest headers naming the segment, harness, and harness-native session id. A session with no committed head yet returns a 204 no-head marker. Serves resume (claim granted at dispatch) and fork (no claim) alike; this route never claims.',
    schema: {
      params: z.object({stepId: z.string().uuid()}),
      querystring: sessionTranscriptQuerySchema,
      response: {
        204: z.void(),
      },
    },
    errorHandler: (error) => toSessionTranscriptRouteError(error),
    handler: async (request, reply) => {
      const {stepId} = request.params;
      const {attempt} = request.query;
      const {session} = await resolveLeasedSessionForStep({
        workflows: params.workflows,
        request,
        stepId,
        attempt,
      });

      // The transcript is lease-scoped secret material: never cached, never
      // client-readable through any session-authed surface.
      reply.header('cache-control', 'no-store');
      reply.header(SESSION_TRANSCRIPT_SEGMENT_HEADER, String(session.headSegment));

      const head = await params.store.readHeadSegment(session);
      if (head === null) {
        // No-head marker for a fresh session: the runner starts the harness
        // with an empty transcript instead of loading one.
        reply.code(204);
        return;
      }

      reply.header(SESSION_TRANSCRIPT_HARNESS_HEADER, head.manifest.harness);
      reply.header(SESSION_TRANSCRIPT_HARNESS_SESSION_ID_HEADER, session.harnessSessionId ?? '');
      reply.type(SESSION_TRANSCRIPT_CONTENT_TYPE);
      return head.blob;
    },
  });
}
