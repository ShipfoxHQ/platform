const mocks = vi.hoisted(() => {
  const gauges = {
    managedInstances: {},
    templateMaxConcurrency: {},
    templateOldestQueuedAge: {},
    templateQueuedDemand: {},
    templateRunners: {},
    templateTargetConcurrency: {},
  };
  const gaugeByName: Record<string, object> = {
    ec2_provisioner_managed_instances: gauges.managedInstances,
    ec2_provisioner_template_max_concurrency: gauges.templateMaxConcurrency,
    ec2_provisioner_template_oldest_queued_age: gauges.templateOldestQueuedAge,
    ec2_provisioner_template_queued_demand: gauges.templateQueuedDemand,
    ec2_provisioner_template_runners: gauges.templateRunners,
    ec2_provisioner_template_target_concurrency: gauges.templateTargetConcurrency,
  };
  return {
    addBatchObservableCallback: vi.fn(),
    createObservableGauge: vi.fn((name: string) => gaugeByName[name]),
    gauges,
    getMeter: vi.fn(),
    getServiceMetricsProvider: vi.fn(),
  };
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));

import type {DemandStatDto} from '@shipfox/api-runners-dto';
import type {ProvisionerTemplate} from '@shipfox/provisioner-core';
import type {Ec2Engine, Ec2InstanceView} from '#ec2-engine.js';
import type {Ec2TemplateSpec} from '#templates.js';
import {registerEc2ServiceMetrics} from './service.js';

const templates: readonly ProvisionerTemplate<Ec2TemplateSpec>[] = [
  {
    key: 'linux',
    labels: ['linux'],
    maxConcurrency: 2,
    targetConcurrency: 1,
    cost: 1,
    spec: ec2Spec(),
  },
  {
    key: 'linux-gpu',
    labels: ['linux', 'gpu'],
    maxConcurrency: 5,
    targetConcurrency: 2,
    cost: 2,
    spec: ec2Spec(),
  },
];

describe('registerEc2ServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.createObservableGauge.mockClear();
    mocks.getMeter.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.getMeter.mockReturnValue({
      createObservableGauge: mocks.createObservableGauge,
      addBatchObservableCallback: mocks.addBatchObservableCallback,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
  });

  it('observes managed instances by bounded EC2 state', async () => {
    const listManaged = vi
      .fn()
      .mockResolvedValue([
        instance('i-pending', 'pending', 'linux'),
        instance('i-running-1', 'running', 'linux'),
        instance('i-running-2', 'running', 'linux'),
      ]);
    const engine = {listManaged} as unknown as Ec2Engine;

    registerEc2ServiceMetrics({
      engine,
      provisionerId: 'provisioner-1',
      templates: templates.slice(0, 1),
      getDemandStats: () => [],
    });
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    const observer = {observe: vi.fn()};

    await callback?.(observer);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith('ec2_provisioner_managed_instances', {
      description: 'EC2 runner instances currently managed by the provisioner, by EC2 state',
    });
    expect(listManaged).toHaveBeenCalledWith('provisioner-1');
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.managedInstances, 1, {
      state: 'pending',
    });
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.managedInstances, 2, {
      state: 'running',
    });
  });

  it('observes AWS-backed template saturation and matching queued demand', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const instances: Ec2InstanceView[] = [
      instance('i-linux-pending', 'pending', 'linux'),
      instance('i-linux-running', 'running', 'linux'),
      instance('i-gpu-running', 'running', 'linux-gpu'),
      instance('i-unknown-running', 'running', 'unconfigured'),
    ];
    const stats: DemandStatDto[] = [
      {
        labels: ['linux'],
        queued: 3,
        reserved: 0,
        oldest_queued_at: new Date(7_000).toISOString(),
      },
      {
        labels: ['linux', 'gpu'],
        queued: 2,
        reserved: 0,
        oldest_queued_at: new Date(8_000).toISOString(),
      },
    ];
    const engine = {listManaged: vi.fn().mockResolvedValue(instances)} as unknown as Ec2Engine;

    try {
      registerEc2ServiceMetrics({
        engine,
        provisionerId: 'provisioner-1',
        templates,
        getDemandStats: () => stats,
      });
      const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
      const observer = {observe: vi.fn()};

      await callback?.(observer);

      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateRunners, 1, {
        template_key: 'linux',
        state: 'starting',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateRunners, 1, {
        template_key: 'linux',
        state: 'running',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateRunners, 0, {
        template_key: 'linux-gpu',
        state: 'starting',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateRunners, 1, {
        template_key: 'linux-gpu',
        state: 'running',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateMaxConcurrency, 2, {
        template_key: 'linux',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateTargetConcurrency, 2, {
        template_key: 'linux-gpu',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateQueuedDemand, 3, {
        template_key: 'linux',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateQueuedDemand, 5, {
        template_key: 'linux-gpu',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateOldestQueuedAge, 3_000, {
        template_key: 'linux',
      });
      expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.templateOldestQueuedAge, 3_000, {
        template_key: 'linux-gpu',
      });
    } finally {
      nowSpy.mockRestore();
    }
  });
});

function instance(
  instanceId: string,
  state: Ec2InstanceView['state'],
  templateKey: string,
): Ec2InstanceView {
  return {
    instanceId,
    state,
    tags: {
      'shipfox.provider_runner_id': instanceId,
      'shipfox.template_key': templateKey,
    },
  };
}

function ec2Spec(): Ec2TemplateSpec {
  return {
    ami: 'ami-0123456789abcdef0',
    instanceType: 't3.small',
    market: 'on-demand',
    spotMaxPrice: null,
    subnets: ['subnet-123'],
    securityGroups: ['sg-123'],
    associatePublicIp: false,
    rootVolumeGb: 20,
    rootDeviceName: '/dev/sda1',
  };
}
