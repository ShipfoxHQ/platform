import {
  type CreateRunnerInstancesBodyDto,
  type CreateRunnerInstancesResponseDto,
  createRunnerInstancesResponseSchema,
  type PollDemandBodyDto,
  type PollDemandResponseDto,
  type ProvisionerIdentityResponseDto,
  pollDemandResponseSchema,
  provisionerIdentityResponseSchema,
  type ReconcileRunnerInstancesBodyDto,
  type ReconcileRunnerInstancesResponseDto,
  type ReportRunnerInstancesBodyDto,
  type ReportRunnerInstancesResponseDto,
  reconcileRunnerInstancesResponseSchema,
  reportRunnerInstancesResponseSchema,
} from '@shipfox/api-runners-dto';
import ky, {HTTPError, type KyInstance} from 'ky';

/** Extra wall-clock the client allows a long-poll beyond its server-side wait. */
const LONG_POLL_TIMEOUT_BUFFER_MS = 15_000;

/** Raised when the provisioner token is missing, revoked, expired, or rejected. */
export class ProvisionerAuthenticationError extends Error {
  constructor(
    public readonly status: number,
    public readonly action = 'API request',
  ) {
    super(`Provisioner token was rejected during ${action} (status ${status}).`);
    this.name = 'ProvisionerAuthenticationError';
  }
}

export interface ProvisionerClient {
  getIdentity(): Promise<ProvisionerIdentityResponseDto>;
  pollDemand(
    body: PollDemandBodyDto,
    options?: {signal?: AbortSignal},
  ): Promise<PollDemandResponseDto>;
  createRunnerInstances(
    body: CreateRunnerInstancesBodyDto,
    options?: {signal?: AbortSignal},
  ): Promise<CreateRunnerInstancesResponseDto>;
  attachRunnerInstanceProviderId(
    runnerInstanceId: string,
    providerRunnerId: string,
    options?: {signal?: AbortSignal},
  ): Promise<{attached: boolean}>;
  assignRunnerInstances(
    reservationId: string,
    runnerInstanceIds: string[],
    options?: {signal?: AbortSignal},
  ): Promise<{runner_instance_ids: string[]}>;
  reportRunnerInstances(
    body: ReportRunnerInstancesBodyDto,
    options?: {signal?: AbortSignal},
  ): Promise<ReportRunnerInstancesResponseDto>;
  reconcileRunnerInstances(
    body: ReconcileRunnerInstancesBodyDto,
    options?: {signal?: AbortSignal},
  ): Promise<ReconcileRunnerInstancesResponseDto>;
}

export function createProvisionerClient(params: {
  baseUrl: string;
  token: string;
}): ProvisionerClient {
  const baseUrl = params.baseUrl.endsWith('/') ? params.baseUrl : `${params.baseUrl}/`;
  const api: KyInstance = ky.create({
    baseUrl,
    headers: {Authorization: `Bearer ${params.token}`},
  });

  return {
    getIdentity() {
      return withAuthMapping('get provisioner identity', async () => {
        const response = await api.get('provisioners/me');
        return provisionerIdentityResponseSchema.parse(await response.json());
      });
    },

    pollDemand(body, options = {}) {
      return withAuthMapping('poll runner demand', async () => {
        const response = await api.post('provisioners/demand/poll', {
          json: body,
          timeout: (body.wait_seconds ?? 0) * 1000 + LONG_POLL_TIMEOUT_BUFFER_MS,
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return pollDemandResponseSchema.parse(await response.json());
      });
    },

    createRunnerInstances(body, options = {}) {
      return withAuthMapping('create runner instances', async () => {
        const response = await api.post('provisioners/runner-instances/batch', {
          json: body,
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return createRunnerInstancesResponseSchema.parse(await response.json());
      });
    },

    attachRunnerInstanceProviderId(runnerInstanceId, providerRunnerId, options = {}) {
      return withAuthMapping('attach runner instance provider identity', async () => {
        const response = await api.post(
          `provisioners/runner-instances/${runnerInstanceId}/provider-runner`,
          {
            json: {provider_runner_id: providerRunnerId},
            ...(options.signal ? {signal: options.signal} : {}),
          },
        );
        return (await response.json()) as {attached: boolean};
      });
    },

    assignRunnerInstances(reservationId, runnerInstanceIds, options = {}) {
      return withAuthMapping('assign runner instances', async () => {
        const response = await api.post('provisioners/runner-instances/assignments', {
          json: {reservation_id: reservationId, runner_instance_ids: runnerInstanceIds},
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return (await response.json()) as {runner_instance_ids: string[]};
      });
    },

    reportRunnerInstances(body, options = {}) {
      return withAuthMapping('report runner instances', async () => {
        const response = await api.post('provisioners/runner-instances/report', {
          json: body,
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return reportRunnerInstancesResponseSchema.parse(await response.json());
      });
    },

    reconcileRunnerInstances(body, options = {}) {
      return withAuthMapping('reconcile runner instances', async () => {
        const response = await api.post('provisioners/runner-instances/reconcile', {
          json: body,
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return reconcileRunnerInstancesResponseSchema.parse(await response.json());
      });
    },
  };
}

// A rejected provisioner token surfaces the same way on every call (poll, mint, or the
// startup identity check), so the loop can recognize "token revoked" rather than treat
// it as a generic transient error.
async function withAuthMapping<T>(action: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof HTTPError && isAuthStatus(error.response.status)) {
      throw new ProvisionerAuthenticationError(error.response.status, action);
    }
    throw error;
  }
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export {HTTPError};
