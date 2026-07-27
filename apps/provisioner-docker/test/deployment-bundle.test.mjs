import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {APPLICATION_RELEASE_IMAGES} from '@shipfox/application-release/dist/manifest.js';
import {DEFAULT_SHIPFOX_API_URL} from '../../../libs/provisioner/core/src/defaults.ts';
import {loadDockerTemplates} from '../../../libs/provisioner/docker/src/templates.ts';

const bundleDirectory = join(import.meta.dirname, '..');
const IMMUTABLE_RELEASE_TAG = /^revision-[0-9a-f]{40}$/;

test('the deployment bundle matches the shipped application contracts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shipfox-provisioner-compose-'));
  try {
    for (const file of ['compose.yaml', '.env.example', 'templates.yaml']) {
      cpSync(join(bundleDirectory, file), join(directory, file));
    }
    cpSync(join(directory, '.env.example'), join(directory, '.env'));

    const rendered = JSON.parse(
      execFileSync('docker', ['compose', 'config', '--format', 'json'], {
        cwd: directory,
        encoding: 'utf8',
      }),
    );
    const service = rendered.services.provisioner;
    const provisionerReference = parseImageReference(service.image);

    assert.equal(provisionerReference.repository, APPLICATION_RELEASE_IMAGES.provisioner);
    assert.match(provisionerReference.tag, IMMUTABLE_RELEASE_TAG);
    assert.equal(service.environment.SHIPFOX_API_URL, DEFAULT_SHIPFOX_API_URL);
    assert.equal(
      service.environment.SHIPFOX_PROVISIONER_TEMPLATES_FILE,
      '/etc/shipfox/templates.yaml',
    );
    assert.equal(service.restart, 'unless-stopped');
    assert.deepEqual(service.extra_hosts, ['host.docker.internal=host-gateway']);

    assertVolume(service.volumes, '/var/run/docker.sock', '/var/run/docker.sock', false);
    assertVolume(
      service.volumes,
      join(directory, 'templates.yaml'),
      '/etc/shipfox/templates.yaml',
      true,
    );

    const [template] = loadDockerTemplates(join(directory, 'templates.yaml'));
    const runnerReference = parseImageReference(template.spec.image);
    assert.equal(runnerReference.repository, APPLICATION_RELEASE_IMAGES.runner);
    assert.equal(runnerReference.tag, provisionerReference.tag);
    assert.deepEqual(template.labels, ['docker', 'ubuntu']);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

function parseImageReference(reference) {
  assert.equal(reference.includes(':latest'), false);
  const separator = reference.lastIndexOf(':');
  assert.notEqual(separator, -1);
  return {
    repository: reference.slice(0, separator),
    tag: reference.slice(separator + 1),
  };
}

function assertVolume(volumes, source, target, readOnly) {
  const volume = volumes.find((candidate) => candidate.target === target);
  assert.ok(volume, `Expected a volume mounted at ${target}`);
  assert.equal(volume.type, 'bind');
  assert.equal(realpathSync(volume.source), realpathSync(source));
  assert.equal(Boolean(volume.read_only), readOnly);
}
