import {AUTH_RUNNER_REGISTRATION_TOKEN} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {getTokenType, hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, gt, isNull, or, sql} from 'drizzle-orm';
import type {FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {resolveManualRegistrationTokenByHash} from '#db/manual-registration-tokens.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {providerRunners} from '#db/schema/runner-instances.js';

const RUNNER_CONTEXT_KEY = 'runner';

export type RunnerRegistrationContext =
  | {
      kind: 'manual';
      registrationTokenId: string;
      workspaceId: string;
    }
  | {kind: 'activation'; activationTokenId: string; workspaceId: string};

export function getRunnerContext(request: FastifyRequest): RunnerRegistrationContext {
  const context = (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] as
    | RunnerRegistrationContext
    | undefined;
  if (!context) {
    throw new Error('Runner context is not available on this request');
  }
  return context;
}

export function createRunnerRegistrationTokenAuthMethod(): AuthMethod {
  return {
    name: AUTH_RUNNER_REGISTRATION_TOKEN,
    authenticate: authenticateRunnerRegistrationToken,
  };
}

async function authenticateRunnerRegistrationToken(request: FastifyRequest): Promise<void> {
  const rawToken = extractBearerToken(request.headers.authorization);
  if (!rawToken) {
    throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {status: 401});
  }
  const tokenType = getTokenType(rawToken);
  if (tokenType === 'runnerActivationToken') {
    await authenticateActivationToken(request, rawToken);
    return;
  }
  if (tokenType !== 'manualRegistrationToken') throw invalidRunnerRegistrationTokenError();
  await authenticateManualRegistrationToken(request, rawToken);
}

async function authenticateActivationToken(
  request: FastifyRequest,
  rawToken: string,
): Promise<void> {
  const [activation] = await db()
    .select({id: runnerActivationTokens.id, workspaceId: providerRunners.workspaceId})
    .from(runnerActivationTokens)
    .innerJoin(providerRunners, eq(providerRunners.id, runnerActivationTokens.runnerInstanceId))
    .leftJoin(provisionerTokens, eq(provisionerTokens.id, providerRunners.provisionerId))
    .where(
      and(
        eq(runnerActivationTokens.hashedToken, hashOpaqueToken(rawToken)),
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
        gt(runnerActivationTokens.expiresAt, sql`now()`),
        or(isNull(provisionerTokens.id), isNull(provisionerTokens.revokedAt)),
        isNull(providerRunners.runnerSessionId),
      ),
    )
    .limit(1);
  if (!activation?.workspaceId) throw invalidRunnerRegistrationTokenError();
  setRunnerContext(request, {
    kind: 'activation',
    activationTokenId: activation.id,
    workspaceId: activation.workspaceId,
  });
}

async function authenticateManualRegistrationToken(
  request: FastifyRequest,
  rawToken: string,
): Promise<void> {
  const token = await resolveManualRegistrationTokenByHash(hashOpaqueToken(rawToken));
  if (!token) throw invalidRunnerRegistrationTokenError();
  if (token.expiresAt && token.expiresAt < new Date()) {
    throw new ClientError('Registration token has expired', 'registration-token-expired', {
      status: 401,
    });
  }
  if (token.revokedAt) {
    throw new ClientError(
      'Manual registration token has been revoked',
      'manual-registration-token-revoked',
      {status: 401},
    );
  }
  setRunnerContext(request, {
    kind: 'manual',
    registrationTokenId: token.id,
    workspaceId: token.workspaceId,
  });
}

function setRunnerContext(request: FastifyRequest, context: RunnerRegistrationContext): void {
  (request as unknown as Record<string, unknown>)[RUNNER_CONTEXT_KEY] = context;
}

function invalidRunnerRegistrationTokenError(): ClientError {
  return new ClientError('Invalid runner registration token', 'unauthorized', {status: 401});
}
