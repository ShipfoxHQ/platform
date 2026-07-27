import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import Docker from 'dockerode';
import {createDockerEngine} from '#docker-engine.js';

describe.skipIf(!hasDockerDaemon())('DockerEngine integration', () => {
  it('creates, lists, inspects, and removes a managed container', {timeout: 60_000}, async () => {
    const engine = createDockerEngine({loggingDriver: 'local'});
    const name = `shipfox-test-${randomUUID()}`;

    try {
      await engine.createAndStart({
        name,
        image: 'alpine:3.20',
        env: {},
        labels: {
          'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
          'shipfox.provider_runner_id': name,
        },
        nanoCpus: 100_000_000,
        memoryBytes: 32 * 1024 * 1024,
      });

      const inspected = await new Docker().getContainer(name).inspect();
      expect(inspected.HostConfig?.LogConfig?.Type).toBe('local');
      const containers = await engine.listManaged('00000000-0000-4000-8000-000000000001');

      expect(containers.some((container) => container.name === name)).toBe(true);
    } finally {
      await engine.remove(name);
    }
  });
});

function hasDockerDaemon(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}
