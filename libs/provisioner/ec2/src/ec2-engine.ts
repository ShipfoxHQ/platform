import {
  DescribeInstancesCommand,
  EC2Client,
  type Instance,
  RunInstancesCommand,
  type RunInstancesCommandInput,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {SHIPFOX_TAGS} from '#instance-identity.js';
import {type Ec2Architecture, recordEc2LaunchDuration} from '#metrics/instance.js';
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
  listManaged(provisionerId: string): Promise<Ec2InstanceView[]>;
  terminate(instanceIds: readonly string[], options?: {force?: boolean}): Promise<void>;
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

    async listManaged(provisionerId) {
      try {
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
            for (const instance of reservation.Instances ?? [])
              instances.push(toInstanceView(instance));
          }
          nextToken = output.NextToken;
        } while (nextToken);

        return instances;
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
  else if (['AuthFailure', 'UnauthorizedOperation', 'Blocked', 'OptInRequired'].includes(name)) {
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
