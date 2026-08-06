import type {ProvisionerTemplate} from '@shipfox/provisioner-core';
import type {Ec2Engine} from '#ec2-engine.js';
import {createEc2ProvisionerAdapter} from '#provisioner.js';
import type {Ec2TemplateSpec} from '#templates.js';

const template: ProvisionerTemplate<Ec2TemplateSpec> = {
  key: 'small',
  labels: ['linux'],
  maxConcurrency: 1,
  cost: 1,
  spec: {
    ami: 'ami-0123456789abcdef0',
    instanceType: 't3.small',
    market: 'on-demand',
    spotMaxPrice: null,
    subnets: ['subnet-123'],
    securityGroups: ['sg-123'],
    associatePublicIp: false,
    rootVolumeGb: 20,
    rootDeviceName: '/dev/sda1',
  },
};

const engine: Ec2Engine = {
  runInstance: () => Promise.reject(new Error('not used')),
  listManaged: () => Promise.resolve([]),
  terminate: () => Promise.resolve(),
};

describe('createEc2ProvisionerAdapter', () => {
  it.each([
    [300_000, 330],
    [600_000, 630],
    [300_001, 331],
    [1, 31],
  ])('derives a reservation TTL with launch headroom from a %d ms registration deadline', (registrationDeadlineMs, reservationTtlSeconds) => {
    const adapter = createEc2ProvisionerAdapter({
      engine,
      templates: [template],
      registrationDeadlineMs,
      launchHeadroomMs: 30_000,
      reconcileIntervalMs: 60_000,
    });

    expect(adapter.reservationTtlSeconds).toBe(reservationTtlSeconds);
  });
});
