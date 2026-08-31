import {
  DescribeInstancesCommand,
  RunInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {createEc2Engine, type RunInstanceArgs} from '#ec2-engine.js';
import {SHIPFOX_TAGS} from '#instance-identity.js';

const observability = vi.hoisted(() => ({recordEc2LaunchDuration: vi.fn()}));

vi.mock('#metrics/instance.js', () => ({
  recordEc2LaunchDuration: observability.recordEc2LaunchDuration,
}));

const runArgs: RunInstanceArgs = {
  clientToken: 'runner-1',
  tags: {
    [SHIPFOX_TAGS.providerRunnerId]: 'runner-1',
    [SHIPFOX_TAGS.provisionerId]: 'provisioner-1',
    Name: 'runner-1',
  },
  ami: 'ami-0123456789abcdef0',
  instanceType: 'm6i.large',
  market: 'on-demand',
  spotMaxPrice: null,
  subnetId: 'subnet-a',
  securityGroupIds: ['sg-a'],
  associatePublicIp: false,
  rootVolumeGb: 100,
  rootDeviceName: '/dev/sda1',
  workspaceVolumeGb: 200,
  workspaceDeviceName: '/dev/sdf',
  userData: '#cloud-config',
};

describe('createEc2Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs one atomically tagged instance with launch settings', async () => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});
    const expectedTags = Object.entries(runArgs.tags).map(([Key, Value]) => ({Key, Value}));

    await engine.runInstance(runArgs);

    expect(commandInput<RunInstancesCommand>(ec2.commands[0])).toMatchObject({
      MinCount: 1,
      MaxCount: 1,
      ClientToken: 'runner-1',
      ImageId: runArgs.ami,
      InstanceType: runArgs.instanceType,
      InstanceInitiatedShutdownBehavior: 'terminate',
      MetadataOptions: {HttpTokens: 'required', HttpPutResponseHopLimit: 1},
      UserData: Buffer.from('#cloud-config').toString('base64'),
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: expectedTags,
        },
        {ResourceType: 'volume', Tags: expectedTags},
      ],
      NetworkInterfaces: [
        {
          DeviceIndex: 0,
          SubnetId: 'subnet-a',
          Groups: ['sg-a'],
          AssociatePublicIpAddress: false,
          DeleteOnTermination: true,
        },
      ],
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/sda1',
          Ebs: {VolumeSize: 100, VolumeType: 'gp3', DeleteOnTermination: true},
        },
        {
          DeviceName: '/dev/sdf',
          Ebs: {VolumeSize: 200, VolumeType: 'gp3', Encrypted: true, DeleteOnTermination: true},
        },
      ],
    });
    expect(commandInput<RunInstancesCommand>(ec2.commands[0])).not.toHaveProperty(
      'IamInstanceProfile',
    );
  });

  it.each([true, false])('passes associatePublicIp=%s to the network interface', async (value) => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.runInstance({...runArgs, associatePublicIp: value});

    expect(commandInput<RunInstancesCommand>(ec2.commands[0]).NetworkInterfaces?.[0]).toMatchObject(
      {
        AssociatePublicIpAddress: value,
      },
    );
  });

  it('uses no market options for on-demand capacity', async () => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.runInstance(runArgs);

    expect(commandInput<RunInstancesCommand>(ec2.commands[0])).not.toHaveProperty(
      'InstanceMarketOptions',
    );
  });

  it('uses one-time Spot capacity with optional max price', async () => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.runInstance({...runArgs, market: 'spot', spotMaxPrice: 0.05});

    expect(commandInput<RunInstancesCommand>(ec2.commands[0]).InstanceMarketOptions).toEqual({
      MarketType: 'spot',
      SpotOptions: {
        SpotInstanceType: 'one-time',
        InstanceInterruptionBehavior: 'terminate',
        MaxPrice: '0.05',
      },
    });
  });

  it('omits a Spot max price when no cap is configured', async () => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.runInstance({...runArgs, market: 'spot'});

    expect(commandInput<RunInstancesCommand>(ec2.commands[0]).InstanceMarketOptions).toEqual({
      MarketType: 'spot',
      SpotOptions: {SpotInstanceType: 'one-time', InstanceInterruptionBehavior: 'terminate'},
    });
  });

  it('maps the launched EC2 instance', async () => {
    const ec2 = fakeEc2({runOutput: {Instances: [instance({State: {Name: 'pending'}})]}});
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    const result = await engine.runInstance(runArgs);

    expect(result).toEqual({
      instanceId: 'i-123',
      tags: {Name: 'runner-1'},
      state: 'pending',
      launchTime: new Date('2026-07-18T12:00:00.000Z'),
    });
  });

  it('records the RunInstances duration with returned instance labels', async () => {
    const ec2 = fakeEc2({
      runOutput: {
        Instances: [
          instance({
            Architecture: 'arm64',
            Placement: {AvailabilityZone: 'eu-west-3b'},
          }),
        ],
      },
    });
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_750);
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never, now});

    await engine.runInstance({
      ...runArgs,
      tags: {...runArgs.tags, [SHIPFOX_TAGS.templateKey]: 'arm-small'},
    });

    expect(observability.recordEc2LaunchDuration).toHaveBeenCalledWith({
      durationMs: 750,
      templateKey: 'arm-small',
      market: 'on-demand',
      architecture: 'arm64',
      availabilityZone: 'eu-west-3b',
    });
  });

  it.each([
    ['InsufficientInstanceCapacity', 'insufficient-capacity', true],
    ['SpotMaxPriceTooLow', 'spot-price-too-low', true],
    ['RequestLimitExceeded', 'throttled', true],
    ['InvalidAMIID.NotFound', 'image-not-found', false],
    ['AuthFailure', 'auth', false],
    ['InvalidParameterValue', 'config-invalid', false],
    ['ECONNREFUSED', 'unreachable', true],
    ['UnexpectedFailure', 'unknown', false],
  ])('classifies %s as %s', async (code, reason, retryable) => {
    const error = awsError(code);
    const ec2 = fakeEc2({runError: error});
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await expect(engine.runInstance(runArgs)).rejects.toMatchObject({reason, retryable});
  });

  it('paginates managed instances and surfaces termination reasons', async () => {
    const ec2 = fakeEc2({
      describeOutputs: [
        {
          Reservations: [
            {
              Instances: [
                instance({
                  ImageId: 'ami-actual',
                  State: {Name: 'terminated'},
                  StateTransitionReason: 'User initiated (2026-07-18 12:01:00 GMT)',
                  StateReason: {
                    Code: 'Server.SpotInstanceTermination',
                    Message: 'Spot capacity reclaimed',
                  },
                }),
              ],
            },
          ],
          NextToken: 'next-page',
        },
        {Reservations: [{Instances: [instance({InstanceId: 'i-456'})]}]},
      ],
    });
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    const result = await engine.listManaged('provisioner-1');

    expect(commandInput<DescribeInstancesCommand>(ec2.commands[0])).toEqual({
      Filters: [{Name: `tag:${SHIPFOX_TAGS.provisionerId}`, Values: ['provisioner-1']}],
      NextToken: undefined,
    });
    expect(commandInput<DescribeInstancesCommand>(ec2.commands[1]).NextToken).toBe('next-page');
    expect(result[0]).toMatchObject({
      instanceId: 'i-123',
      state: 'terminated',
      stateTransitionReason: 'User initiated (2026-07-18 12:01:00 GMT)',
      stateReasonCode: 'Server.SpotInstanceTermination',
      stateReasonMessage: 'Spot capacity reclaimed',
      ami: 'ami-actual',
    });
    expect(result[1]?.instanceId).toBe('i-456');
  });

  it.each([
    ['pending', 'pending'],
    ['running', 'running'],
    ['shutting-down', 'shutting-down'],
    ['stopping', 'stopping'],
    ['stopped', 'stopped'],
    ['terminated', 'terminated'],
    ['unrecognized', 'unknown'],
  ])('maps the %s EC2 state to %s', async (state, expected) => {
    const ec2 = fakeEc2({
      describeOutputs: [{Reservations: [{Instances: [instance({State: {Name: state}})]}]}],
    });
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    const result = await engine.listManaged('provisioner-1');

    expect(result[0]?.state).toBe(expected);
  });

  it('returns no managed instances when EC2 has no reservations', async () => {
    const ec2 = fakeEc2({describeOutputs: [{}]});
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    const result = await engine.listManaged('provisioner-1');

    expect(result).toEqual([]);
  });

  it('terminates the requested instances', async () => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.terminate(['i-123', 'i-456']);

    expect(ec2.commands.map(commandInput<TerminateInstancesCommand>)).toEqual([
      {InstanceIds: ['i-123']},
      {InstanceIds: ['i-456']},
    ]);
  });

  it('force-terminates a stuck instance when requested', async () => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.terminate(['i-stuck'], {force: true});

    expect(ec2.commands.map(commandInput<TerminateInstancesCommand>)).toEqual([
      {InstanceIds: ['i-stuck'], Force: true},
    ]);
  });

  it('does not call EC2 to terminate an empty set', async () => {
    const ec2 = fakeEc2();
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.terminate([]);

    expect(ec2.commands).toEqual([]);
  });

  it('treats absent EC2 instances as already terminated', async () => {
    const ec2 = fakeEc2({terminateError: awsError('InvalidInstanceID.NotFound')});
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await expect(engine.terminate(['i-missing'])).resolves.toBeUndefined();
  });

  it('continues terminating present instances when one is already absent', async () => {
    const ec2 = fakeEc2({
      terminateErrorById: new Map([['i-gone', awsError('InvalidInstanceID.NotFound')]]),
    });
    const engine = createEc2Engine({region: 'eu-west-3', client: ec2 as never});

    await engine.terminate(['i-gone', 'i-live']);

    expect(ec2.commands.map(commandInput<TerminateInstancesCommand>)).toEqual([
      {InstanceIds: ['i-gone']},
      {InstanceIds: ['i-live']},
    ]);
  });
});

function fakeEc2(
  options: {
    runOutput?: unknown;
    runError?: Error;
    describeOutputs?: unknown[];
    terminateError?: Error;
    terminateErrorById?: Map<string, Error>;
  } = {},
) {
  const commands: unknown[] = [];
  const describeOutputs = [...(options.describeOutputs ?? [])];

  return {
    commands,
    send(command: unknown) {
      commands.push(command);
      if (command instanceof RunInstancesCommand) {
        if (options.runError) return Promise.reject(options.runError);
        return Promise.resolve(options.runOutput ?? {Instances: [instance()]});
      }
      if (command instanceof DescribeInstancesCommand)
        return Promise.resolve(describeOutputs.shift() ?? {});
      if (command instanceof TerminateInstancesCommand)
        return terminateInstanceResponse(command, options);
      return Promise.reject(new Error('Unexpected EC2 command'));
    },
  };
}

function terminateInstanceResponse(
  command: TerminateInstancesCommand,
  options: {
    terminateError?: Error;
    terminateErrorById?: Map<string, Error>;
  },
): Promise<unknown> {
  const instanceId = command.input.InstanceIds?.[0];
  const terminateError =
    options.terminateErrorById?.get(instanceId ?? '') ?? options.terminateError;
  return terminateError ? Promise.reject(terminateError) : Promise.resolve({});
}

function commandInput<T extends {input: unknown}>(command: unknown): T['input'] {
  return (command as T).input;
}

function instance(overrides: Record<string, unknown> = {}) {
  return {
    InstanceId: 'i-123',
    Tags: [{Key: 'Name', Value: 'runner-1'}],
    State: {Name: 'running'},
    LaunchTime: new Date('2026-07-18T12:00:00.000Z'),
    ...overrides,
  };
}

function awsError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  if (name === 'ECONNREFUSED') Object.assign(error, {code: name});
  return error;
}
