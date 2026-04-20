import {type AuthMethod, ClientError} from '@shipfox/node-fastify';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import type {FastifyRequest} from 'fastify';
import {resolveRunnerTokenByHash} from '#db/runner-tokens.js';

const RUNNER_CONTEXT_KEY = 'runner';

export interface RunnerAuthContext {
  runnerTokenId: string;
  workspaceId: string;
  revokedAt: Date | null;
}

function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') return undefined;
  return parts[1];
}

export function getRunnerContext(request: FastifyRequest): RunnerAuthContext {
  const context = (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] as
    | RunnerAuthContext
    | undefined;
  if (!context) {
    throw new Error('Runner context is not available on this request');
  }
  return context;
}

export function createRunnerTokenAuthMethod(): AuthMethod {
  return {
    name: 'runner-token',
    authenticate: async (request) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (!rawToken) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      const token = await resolveRunnerTokenByHash(hashOpaqueToken(rawToken));
      if (!token) {
        throw new ClientError('Invalid runner token', 'unauthorized', {status: 401});
      }

      if (token.expiresAt && token.expiresAt < new Date()) {
        throw new ClientError('Runner token has expired', 'runner-token-expired', {status: 401});
      }

      (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] = {
        runnerTokenId: token.id,
        workspaceId: token.workspaceId,
        revokedAt: token.revokedAt,
      } satisfies RunnerAuthContext;
    },
  };
}
