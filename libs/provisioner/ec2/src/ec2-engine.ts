import {
  DescribeInstanceStatusCommand,
  DescribeInstancesCommand,
  type EbsStatusSummary,
  EC2Client,
  type Instance,
  type InstanceStatus,
  type InstanceStatusEvent,
  type InstanceStatusSummary,
  RunInstancesCommand,
  type RunInstancesCommandInput,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {logger} from '@shipfox/node-opentelemetry';
import {SHIPFOX_TAGS} from '#instance-identity.js';
import {
  type Ec2Architecture,
  type Ec2HealthObservationStatus,
  recordEc2HealthObservation,
  recordEc2HealthObserverCycle,
  recordEc2LaunchDuration,
} from '#metrics/instance.js';
import {type Ec2Market, UNKNOWN_TEMPLATE_KEY} from '#templates.js';

const TRANSIENT_REASONS = new Set<Ec2EngineErrorReason>([
  'insufficient-capacity',
  'spot-price-too-low',
  'throttled',
  'unreachable',
]);

export type Ec2EngineErrorReason =
  | 'insufficient-capacity'
  | 'spot-price-too-low'
  | 'throttled'
  | 'image-not-found'
  | 'auth'
  | 'config-invalid'
  | 'unreachable'
  | 'unknown';

export class Ec2EngineError extends Error {
  public readonly retryable: boolean;

  constructor(
    public readonly reason: Ec2EngineErrorReason,
    message: string,
    options?: {cause?: unknown},
  ) {
    super(message, options);
    this.name = 'Ec2EngineError';
    this.retryable = TRANSIENT_REASONS.has(reason);
  }
}

export type Ec2InstanceState =
  | 'pending'
  | 'running'
  | 'shutting-down'
  | 'stopping'
  | 'stopped'
  | 'terminated'
  | 'unknown';

export type Ec2StatusCheckStatus = Ec2HealthObservationStatus;

export interface Ec2StatusCheck {
  readonly status: Ec2StatusCheckStatus;
  readonly impairedSince?: Date;
}

export type Ec2ScheduledEventCode =
  | 'instance-reboot'
  | 'system-reboot'
  | 'system-maintenance'
  | 'instance-retirement'
  | 'instance-stop'
  | 'unknown';

export interface Ec2ScheduledEvent {
  readonly code: Ec2ScheduledEventCode;
  readonly notBefore?: Date;
  readonly notAfter?: Date;
  readonly notBeforeDeadline?: Date;
}

export interface Ec2InstanceView {
  readonly instanceId: string;
  readonly ami?: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly state: Ec2InstanceState;
  readonly architecture?: Ec2Architecture;
  readonly availabilityZone?: string;
  readonly stateTransitionReason?: string;
  readonly stateReasonCode?: string;
  readonly stateReasonMessage?: string;
  readonly launchTime?: Date;
  readonly systemStatus?: Ec2StatusCheck;
  readonly instanceStatus?: Ec2StatusCheck;
  readonly attachedEbsStatus?: Ec2StatusCheck;
  readonly scheduledEvents?: readonly Ec2ScheduledEvent[];
}

export interface RunInstanceArgs {
  readonly clientToken: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly ami: string;
  readonly instanceType: string;
  readonly market: Ec2Market;
  readonly spotMaxPrice: number | null;
  readonly subnetId: string;
  readonly securityGroupIds: readonly string[];
  readonly associatePublicIp: boolean;
  readonly rootVolumeGb: number;
  readonly rootDeviceName: string;
  readonly workspaceVolumeGb: number;
  readonly workspaceDeviceName: string;
  readonly userData?: string;
}

export interface Ec2Engine {
  runInstance(args: RunInstanceArgs): Promise<Ec2InstanceView>;
  listManaged(provisionerId: string, options?: Ec2ListManagedOptions): Promise<Ec2InstanceView[]>;
  terminate(instanceIds: readonly string[], options?: {force?: boolean}): Promise<void>;
}

export interface Ec2ListManagedOptions {
  /** Reconciliation requires the additional EC2 status-check permission. */
  readonly includeStatus?: boolean;
}

export interface CreateEc2EngineOptions {
  readonly region: string;
  readonly client?: EC2Client;
  readonly now?: () => number;
}

export function createEc2Engine(options: CreateEc2EngineOptions): Ec2Engine {
  const client = options.client ?? new EC2Client({region: options.region});
  const now = options.now ?? (() => Date.now());

  return {
    async runInstance(args) {
      const startedAt = now();
      try {
        const output = await client.send(
          new RunInstancesCommand({
            MinCount: 1,
            MaxCount: 1,
            ClientToken: args.clientToken,
            ImageId: args.ami,
            InstanceType: args.instanceType as RunInstancesCommandInput['InstanceType'],
            TagSpecifications: (['instance', 'volume'] as const).map((ResourceType) => ({
              ResourceType,
              Tags: Object.entries(args.tags).map(([Key, Value]) => ({Key, Value})),
            })),
            InstanceInitiatedShutdownBehavior: 'terminate',
            MetadataOptions: {
              HttpTokens: 'required',
              HttpPutResponseHopLimit: 1,
            },
            // A network interface is required for AssociatePublicIpAddress to work consistently.
            NetworkInterfaces: [
              {
                DeviceIndex: 0,
                SubnetId: args.subnetId,
                Groups: [...args.securityGroupIds],
                AssociatePublicIpAddress: args.associatePublicIp,
                DeleteOnTermination: true,
              },
            ],
            // A mismatched root device silently adds a volume and ignores the requested size.
            BlockDeviceMappings: [
              {
                DeviceName: args.rootDeviceName,
                Ebs: {
                  VolumeSize: args.rootVolumeGb,
                  VolumeType: 'gp3',
                  DeleteOnTermination: true,
                },
              },
              {
                DeviceName: args.workspaceDeviceName,
                Ebs: {
                  VolumeSize: args.workspaceVolumeGb,
                  VolumeType: 'gp3',
                  Encrypted: true,
                  DeleteOnTermination: true,
                },
              },
            ],
            ...(args.market === 'spot'
              ? {
                  InstanceMarketOptions: {
                    MarketType: 'spot' as const,
                    SpotOptions: {
                      SpotInstanceType: 'one-time' as const,
                      InstanceInterruptionBehavior: 'terminate' as const,
                      ...(args.spotMaxPrice != null ? {MaxPrice: String(args.spotMaxPrice)} : {}),
                    },
                  },
                }
              : {}),
            ...(args.userData ? {UserData: Buffer.from(args.userData).toString('base64')} : {}),
          }),
        );
        const completedAt = now();
        const instance = output.Instances?.[0];
        if (!instance)
          throw new Ec2EngineError('unknown', 'EC2 did not return a launched instance.');
        const view = toInstanceView(instance);
        recordEc2LaunchDuration({
          durationMs: completedAt - startedAt,
          templateKey: args.tags[SHIPFOX_TAGS.templateKey] ?? UNKNOWN_TEMPLATE_KEY,
          market: args.market,
          architecture: view.architecture ?? 'unknown',
          availabilityZone: view.availabilityZone ?? 'unknown',
        });
        return view;
      } catch (error) {
        recordEc2LaunchDuration({
          durationMs: now() - startedAt,
          templateKey: args.tags[SHIPFOX_TAGS.templateKey] ?? UNKNOWN_TEMPLATE_KEY,
          market: args.market,
          architecture: 'unknown',
          availabilityZone: 'unknown',
        });
        throw mapEc2Error(error, 'Cannot launch EC2 runner instance.');
      }
    },

    async listManaged(provisionerId, options) {
      try {
        const instances = await describeManagedInstances(client, provisionerId);

        if (!options?.includeStatus) return instances;
        if (instances.length === 0) {
          recordEc2HealthObserverCycle('empty');
          return instances;
        }

        let statusRead: Ec2InstanceStatusRead;
        try {
          statusRead = await readManagedInstanceStatuses(client, provisionerId, instances);
        } catch (error) {
          recordEc2HealthObserverCycle('unavailable');
          throw error;
        }
        recordEc2HealthObserverCycle(statusRead.outcome);
        if (statusRead.outcome === 'complete')
          recordHealthObservations(instances, statusRead.statusByInstanceId);

        return instances.map((instance) => {
          const status = statusRead.statusByInstanceId.get(instance.instanceId);
          return status ? {...instance, ...status} : instance;
        });
      } catch (error) {
        throw mapEc2Error(error, 'Cannot list managed EC2 instances.');
      }
    },

    async terminate(instanceIds, options) {
      if (instanceIds.length === 0) return;

      for (const instanceId of instanceIds) {
        try {
          await client.send(
            new TerminateInstancesCommand({
              InstanceIds: [instanceId],
              ...(options?.force ? {Force: true} : {}),
            }),
          );
        } catch (error) {
          if (errorName(error) === 'InvalidInstanceID.NotFound') continue;
          throw mapEc2Error(error, 'Cannot terminate EC2 runner instance.');
        }
      }
    },
  };
}

async function describeManagedInstances(
  client: EC2Client,
  provisionerId: string,
): Promise<Ec2InstanceView[]> {
  const instances: Ec2InstanceView[] = [];
  let nextToken: string | undefined;

  do {
    const output = await client.send(
      new DescribeInstancesCommand({
        NextToken: nextToken,
        Filters: [{Name: `tag:${SHIPFOX_TAGS.provisionerId}`, Values: [provisionerId]}],
      }),
    );
    for (const reservation of output.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) instances.push(toInstanceView(instance));
    }
    nextToken = output.NextToken;
  } while (nextToken);

  return instances;
}

async function readManagedInstanceStatuses(
  client: EC2Client,
  provisionerId: string,
  instances: readonly Ec2InstanceView[],
): Promise<Ec2InstanceStatusRead> {
  try {
    // The reconciliation path requires ec2:DescribeInstanceStatus. Auth and other permanent
    // status-read failures are propagated so health enforcement fails closed. Retryable failures
    // keep the ordinary instance snapshot, as does the stale-instance race that EC2 reports as
    // InvalidInstanceID.NotFound.
    return {
      statusByInstanceId: await describeInstanceStatuses(
        client,
        instances.map((instance) => instance.instanceId),
      ),
      outcome: 'complete',
    };
  } catch (error) {
    const mappedError = mapEc2Error(error, 'Cannot read managed EC2 instance statuses.');
    if (!mappedError.retryable && !isStaleInstanceStatusError(error)) throw mappedError;
    logger().warn(
      {
        event: 'provisioner.ec2.status_checks_unavailable',
        provisioner_id: provisionerId,
        reason: mappedError.reason,
      },
      'EC2 status checks unavailable; continuing with the instance snapshot',
    );
    return {statusByInstanceId: new Map(), outcome: 'unavailable'};
  }
}

function isStaleInstanceStatusError(error: unknown): boolean {
  return errorName(error) === 'InvalidInstanceID.NotFound';
}

const MAX_STATUS_INSTANCE_IDS = 100;

type Ec2InstanceStatusFields = Pick<
  Ec2InstanceView,
  'systemStatus' | 'instanceStatus' | 'attachedEbsStatus' | 'scheduledEvents'
>;

type Ec2InstanceStatusRead = {
  statusByInstanceId: ReadonlyMap<string, Ec2InstanceStatusFields>;
  outcome: 'complete' | 'unavailable';
};

function recordHealthObservations(
  instances: readonly Ec2InstanceView[],
  statusByInstanceId: ReadonlyMap<string, Ec2InstanceStatusFields>,
): void {
  for (const instance of instances) {
    const status = statusByInstanceId.get(instance.instanceId);
    recordEc2HealthObservation('system', status?.systemStatus?.status ?? 'not-applicable');
    recordEc2HealthObservation('instance', status?.instanceStatus?.status ?? 'not-applicable');
    recordEc2HealthObservation(
      'attached-ebs',
      status?.attachedEbsStatus?.status ?? 'not-applicable',
    );
  }
}

async function describeInstanceStatuses(
  client: EC2Client,
  instanceIds: readonly string[],
): Promise<ReadonlyMap<string, Ec2InstanceStatusFields>> {
  if (instanceIds.length === 0) return new Map();

  const statuses = new Map<string, Ec2InstanceStatusFields>();
  for (let start = 0; start < instanceIds.length; start += MAX_STATUS_INSTANCE_IDS) {
    const batch = instanceIds.slice(start, start + MAX_STATUS_INSTANCE_IDS);
    const batchStatuses = await describeInstanceStatusBatch(client, batch);
    for (const [instanceId, fields] of batchStatuses) statuses.set(instanceId, fields);
  }
  return statuses;
}

async function describeInstanceStatusBatch(
  client: EC2Client,
  instanceIds: readonly string[],
): Promise<ReadonlyMap<string, Ec2InstanceStatusFields>> {
  try {
    return await describeInstanceStatusBatchPages(client, instanceIds);
  } catch (error) {
    if (!isStaleInstanceStatusError(error) || instanceIds.length <= 1) throw error;

    // DescribeInstanceStatus rejects the whole request when one ID was terminated after
    // DescribeInstances. Retry each ID to retain the remaining statuses and skip only the stale
    // instance. This fallback is limited to the stale-ID race and does not mask other errors.
    return retryStatusBatchByInstance(client, instanceIds);
  }
}

async function retryStatusBatchByInstance(
  client: EC2Client,
  instanceIds: readonly string[],
): Promise<ReadonlyMap<string, Ec2InstanceStatusFields>> {
  const statuses = new Map<string, Ec2InstanceStatusFields>();
  for (const instanceId of instanceIds) {
    try {
      const instanceStatuses = await describeInstanceStatusBatchPages(client, [instanceId]);
      for (const [statusInstanceId, fields] of instanceStatuses)
        statuses.set(statusInstanceId, fields);
    } catch (error) {
      if (!isStaleInstanceStatusError(error)) throw error;
    }
  }
  return statuses;
}

async function describeInstanceStatusBatchPages(
  client: EC2Client,
  instanceIds: readonly string[],
): Promise<ReadonlyMap<string, Ec2InstanceStatusFields>> {
  const statuses = new Map<string, Ec2InstanceStatusFields>();
  let nextToken: string | undefined;
  do {
    const output = await client.send(
      new DescribeInstanceStatusCommand({
        InstanceIds: [...instanceIds],
        IncludeAllInstances: true,
        NextToken: nextToken,
      }),
    );
    for (const status of output.InstanceStatuses ?? []) {
      const fields = toInstanceStatusFields(status);
      if (status.InstanceId && fields) statuses.set(status.InstanceId, fields);
    }
    nextToken = output.NextToken;
  } while (nextToken);
  return statuses;
}

function toInstanceStatusFields(status: InstanceStatus): Ec2InstanceStatusFields {
  const systemStatus = toStatusCheck(status.SystemStatus);
  const instanceStatus = toStatusCheck(status.InstanceStatus);
  const attachedEbsStatus = toStatusCheck(status.AttachedEbsStatus);

  return {
    ...(systemStatus ? {systemStatus} : {}),
    ...(instanceStatus ? {instanceStatus} : {}),
    ...(attachedEbsStatus ? {attachedEbsStatus} : {}),
    scheduledEvents: (status.Events ?? []).map(toScheduledEvent),
  };
}

function toStatusCheck(
  summary: InstanceStatusSummary | EbsStatusSummary | undefined,
): Ec2StatusCheck | undefined {
  if (!summary) return undefined;
  const reachabilityDetail = summary.Details?.find((detail) => detail.Name === 'reachability');
  const impairedSince =
    reachabilityDetail && 'ImpairedSince' in reachabilityDetail
      ? reachabilityDetail.ImpairedSince
      : undefined;
  return {
    status: normalizeStatusCheckStatus(summary.Status),
    ...(impairedSince ? {impairedSince} : {}),
  };
}

function toScheduledEvent(event: InstanceStatusEvent): Ec2ScheduledEvent {
  return {
    code: normalizeScheduledEventCode(event.Code),
    ...(event.NotBefore ? {notBefore: event.NotBefore} : {}),
    ...(event.NotAfter ? {notAfter: event.NotAfter} : {}),
    ...(event.NotBeforeDeadline ? {notBeforeDeadline: event.NotBeforeDeadline} : {}),
  };
}

function normalizeStatusCheckStatus(status: string | undefined): Ec2StatusCheckStatus {
  switch (status) {
    case 'ok':
    case 'impaired':
    case 'initializing':
    case 'insufficient-data':
    case 'not-applicable':
      return status;
    default:
      return 'unknown';
  }
}

function normalizeScheduledEventCode(code: string | undefined): Ec2ScheduledEventCode {
  switch (code) {
    case 'instance-reboot':
    case 'system-reboot':
    case 'system-maintenance':
    case 'instance-retirement':
    case 'instance-stop':
      return code;
    default:
      return 'unknown';
  }
}

function toInstanceView(instance: Instance): Ec2InstanceView {
  if (!instance.InstanceId) throw new Ec2EngineError('unknown', 'EC2 instance has no instance id.');

  return {
    instanceId: instance.InstanceId,
    ...(instance.ImageId ? {ami: instance.ImageId} : {}),
    tags: Object.fromEntries(
      (instance.Tags ?? []).flatMap(({Key, Value}) =>
        Key !== undefined && Value !== undefined ? [[Key, Value]] : [],
      ),
    ),
    state: normalizeState(instance.State?.Name),
    ...(instance.Architecture ? {architecture: normalizeArchitecture(instance.Architecture)} : {}),
    ...(instance.Placement?.AvailabilityZone
      ? {availabilityZone: instance.Placement.AvailabilityZone}
      : {}),
    ...(instance.StateTransitionReason
      ? {stateTransitionReason: instance.StateTransitionReason}
      : {}),
    ...(instance.StateReason?.Code ? {stateReasonCode: instance.StateReason.Code} : {}),
    ...(instance.StateReason?.Message ? {stateReasonMessage: instance.StateReason.Message} : {}),
    ...(instance.LaunchTime ? {launchTime: instance.LaunchTime} : {}),
  };
}

function normalizeArchitecture(architecture: string | undefined): Ec2Architecture {
  switch (architecture) {
    case 'i386':
    case 'x86_64':
    case 'arm64':
      return architecture;
    default:
      return 'unknown';
  }
}

function normalizeState(state: string | undefined): Ec2InstanceState {
  switch (state) {
    case 'pending':
    case 'running':
    case 'shutting-down':
    case 'stopping':
    case 'stopped':
    case 'terminated':
      return state;
    default:
      return 'unknown';
  }
}

function mapEc2Error(error: unknown, message: string): Ec2EngineError {
  if (error instanceof Ec2EngineError) return error;

  const name = errorName(error);
  let reason: Ec2EngineErrorReason = 'unknown';
  if (name === 'InsufficientInstanceCapacity') reason = 'insufficient-capacity';
  else if (name === 'SpotMaxPriceTooLow') reason = 'spot-price-too-low';
  else if (
    name === 'RequestLimitExceeded' ||
    name.startsWith('Throttling') ||
    name === 'EC2ThrottledException' ||
    name === 'SlowDown'
  ) {
    reason = 'throttled';
  } else if (name.startsWith('InvalidAMIID.')) reason = 'image-not-found';
  else if (
    [
      'AccessDenied',
      'AccessDeniedException',
      'AuthFailure',
      'UnauthorizedOperation',
      'InvalidClientTokenId',
      'SignatureDoesNotMatch',
      'UnrecognizedClientException',
      'Blocked',
      'OptInRequired',
    ].includes(name)
  ) {
    reason = 'auth';
  } else if (
    name.startsWith('Invalid') ||
    name.startsWith('Missing') ||
    name.startsWith('Unsupported')
  ) {
    reason = 'config-invalid';
  } else if (isUnreachable(error, name)) reason = 'unreachable';

  return new Ec2EngineError(reason, message, {cause: error});
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

function isUnreachable(error: unknown, name: string): boolean {
  if (name === 'TimeoutError') return true;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(
      String(error.code),
    )
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata !== null &&
    'httpStatusCode' in error.$metadata &&
    typeof error.$metadata.httpStatusCode === 'number' &&
    error.$metadata.httpStatusCode >= 500
  );
}
