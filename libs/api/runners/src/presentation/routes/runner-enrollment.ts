import {
  requireProvisionerContext,
  requireRunnerControlSessionContext,
} from '@shipfox/api-auth-context';
import {
  attachRunnerControlProviderIdBodySchema,
  createRunnerInstancesBodySchema,
  createRunnerInstancesResponseSchema,
  runnerAssignmentPollResponseSchema,
  runnerBootstrapExchangeBodySchema,
  runnerBootstrapExchangeResponseSchema,
  runnerControlHeartbeatResponseSchema,
  runnerEnrollmentBodySchema,
  runnerEnrollmentResponseSchema,
} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {config} from '#config.js';
import {getRunnerAssignment, issueRunnerActivationToken} from '#core/runner-activation.js';
import {
  attachRunnerControlProviderId,
  createRunnerInstancesWithBootstrapTokens,
  enrollRunnerControlSession,
  exchangeRunnerBootstrapToken,
  RunnerBootstrapTokenInvalidError,
  RunnerControlSessionInvalidError,
  touchRunnerControlSession,
} from '#core/runner-control-sessions.js';
import {attachRunnerInstanceProviderId} from '#core/runner-instances.js';
import {runnerBootstrapExchangeCount, runnerControlHeartbeatCount} from '#metrics/instance.js';
import {authenticateRunnerControlSession} from '#presentation/auth/index.js';

export const createRunnerInstancesRoute = defineRoute({
  method: 'POST',
  path: '/runner-instances/batch',
  description:
    'Create provisioner-owned runner instances and one-use bootstrap tokens before launch',
  schema: {
    body: createRunnerInstancesBodySchema,
    response: {200: createRunnerInstancesResponseSchema},
  },
  handler: async (request) => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    const results = await createRunnerInstancesWithBootstrapTokens({
      provisionerId: provisionerTokenId,
      ...(request.body.provider_kind ? {providerKind: request.body.provider_kind} : {}),
      runnerInstances: request.body.runner_instances.map((runner) => ({
        ...(runner.template_key ? {templateKey: runner.template_key} : {}),
        ...(runner.reservation_id ? {reservationId: runner.reservation_id} : {}),
      })),
      ttlSeconds: config.RUNNER_BOOTSTRAP_TOKEN_TTL_SECONDS,
    });
    return {
      runner_instances: results.map((result) => ({
        runner_instance_id: result.runnerInstanceId,
        bootstrap_token: result.bootstrapToken,
      })),
    };
  },
});

export const attachRunnerInstanceProviderIdRoute = defineRoute({
  method: 'POST',
  path: '/runner-instances/:runnerInstanceId/provider-runner',
  description: 'Attach the provider identity after the provisioner launches a runner instance',
  schema: {
    params: z.object({runnerInstanceId: z.string().uuid()}),
    body: attachRunnerControlProviderIdBodySchema,
    response: {200: z.object({attached: z.boolean()})},
  },
  handler: async (request) => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    return {
      attached: await attachRunnerInstanceProviderId({
        runnerInstanceId: request.params.runnerInstanceId,
        provisionerId: provisionerTokenId,
        providerRunnerId: request.body.provider_runner_id,
      }),
    };
  },
});

export const exchangeRunnerBootstrapRoute = defineRoute({
  method: 'POST',
  path: '/exchange',
  description: 'Exchange a one-use runner bootstrap token for a workspace-neutral control session',
  schema: {
    body: runnerBootstrapExchangeBodySchema,
    response: {200: runnerBootstrapExchangeResponseSchema},
  },
  errorHandler: (error) => {
    if (error instanceof RunnerBootstrapTokenInvalidError)
      runnerBootstrapExchangeCount.add(1, {outcome: 'rejected'});
    if (error instanceof RunnerBootstrapTokenInvalidError)
      throw new ClientError(error.message, 'runner-bootstrap-token-invalid', {status: 401});
    throw error;
  },
  handler: async (request) => {
    const result = await exchangeRunnerBootstrapToken({
      rawToken: request.body.bootstrap_token,
      ttlSeconds: config.RUNNER_CONTROL_SESSION_TTL_SECONDS,
    });
    runnerBootstrapExchangeCount.add(1, {outcome: 'accepted'});
    return {
      runner_instance_id: result.runnerInstanceId,
      control_session_token: result.controlSessionToken,
      expires_at: result.expiresAt.toISOString(),
    };
  },
});

export const enrollRunnerRoute = defineRoute({
  method: 'POST',
  path: '/enrollment',
  description: 'Declare the authenticated runner instance labels and protocol capabilities',
  schema: {body: runnerEnrollmentBodySchema, response: {200: runnerEnrollmentResponseSchema}},
  preHandler: authenticateRunnerControlSession,
  errorHandler: (error) => {
    if (error instanceof RunnerControlSessionInvalidError)
      throw new ClientError(error.message, 'runner-control-session-invalid', {status: 409});
    throw error;
  },
  handler: async (request) => {
    const session = requireRunnerControlSessionContext(request);
    const activationToken = await enrollRunnerControlSession({
      runnerInstanceId: session.runnerInstanceId,
      provisionerId: session.provisionerId,
      labels: request.body.labels,
      ...(request.body.capabilities ? {capabilities: request.body.capabilities} : {}),
      providerKind: request.body.provider_kind,
      protocolVersion: request.body.protocol_version,
    });
    return {activation_token: activationToken};
  },
});

export const attachRunnerControlProviderIdRoute = defineRoute({
  method: 'POST',
  path: '/provider-runner',
  description: 'Attach the authenticated runner instance provider identity once',
  schema: {
    body: attachRunnerControlProviderIdBodySchema,
    response: {200: z.object({attached: z.boolean()})},
  },
  preHandler: authenticateRunnerControlSession,
  handler: async (request) => {
    const session = requireRunnerControlSessionContext(request);
    return {
      attached: await attachRunnerControlProviderId({
        ...session,
        providerRunnerId: request.body.provider_runner_id,
      }),
    };
  },
});

export const runnerControlHeartbeatRoute = defineRoute({
  method: 'POST',
  path: '/heartbeat',
  description: 'Record liveness for only the authenticated runner instance',
  schema: {response: {200: runnerControlHeartbeatResponseSchema}},
  preHandler: authenticateRunnerControlSession,
  handler: async (request) => {
    const session = requireRunnerControlSessionContext(request);
    await touchRunnerControlSession(session.runnerInstanceId, session.provisionerId);
    runnerControlHeartbeatCount.add(1);
    return {ok: true};
  },
});

type RunnerAssignmentPollParams = {
  deadline: number;
  intervalMs: number;
  signal: AbortSignal;
  getAssignment: () => Promise<unknown | null>;
  issueActivationToken: () => Promise<string | null>;
};
export async function pollForRunnerActivationToken(
  params: RunnerAssignmentPollParams,
): Promise<string | null> {
  while (Date.now() <= params.deadline) {
    if (params.signal.aborted) return null;
    const assignment = await params.getAssignment();
    if (assignment) {
      const activationToken = await params.issueActivationToken();
      if (activationToken) return activationToken;
    }
    await new Promise((resolve) => setTimeout(resolve, params.intervalMs));
  }
  return null;
}
export const runnerAssignmentPollRoute = defineRoute({
  method: 'GET',
  path: '/assignment',
  description: 'Wait for only the authenticated runner instance assignment',
  schema: {response: {200: runnerAssignmentPollResponseSchema}},
  preHandler: authenticateRunnerControlSession,
  handler: async (request, reply) => {
    const session = requireRunnerControlSessionContext(request);
    const deadline = Date.now() + config.RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS * 1000;
    const abortController = new AbortController();
    reply.raw.on('close', () => abortController.abort());
    const activationToken = await pollForRunnerActivationToken({
      deadline,
      intervalMs: config.RUNNER_ASSIGNMENT_POLL_INTERVAL_MS,
      signal: abortController.signal,
      getAssignment: () => getRunnerAssignment(session),
      issueActivationToken: () =>
        issueRunnerActivationToken({
          ...session,
          ttlSeconds: config.RUNNER_ACTIVATION_TOKEN_TTL_SECONDS,
        }),
    });
    return {activation_token: activationToken};
  },
});
