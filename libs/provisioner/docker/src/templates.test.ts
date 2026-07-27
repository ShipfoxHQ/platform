import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_RUNNER_IMAGE, DockerTemplateConfigError, loadDockerTemplates} from '#templates.js';

const mocks = vi.hoisted(() => ({warn: vi.fn()}));
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => mocks}));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'provisioner-docker-'));
  mocks.warn.mockReset();
});

afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function writeTemplates(contents: string): string {
  const path = join(dir, `${randomUUID()}.yaml`);
  writeFileSync(path, contents);
  return path;
}

const VALID = `
templates:
  docker-ubuntu22-2vcpu:
    labels: [ubuntu22, ubuntu22-2vcpu]
    image: shipfox-runner:ubuntu22
    cpu: 2
    memory: 4GiB
    max_concurrency: 100
  docker-ubuntu22-4vcpu:
    labels: [ubuntu22, ubuntu22-4vcpu]
    image: shipfox-runner:ubuntu22
    cpu: 4
    memory: 8GiB
    max_concurrency: 50
    cost: 6
`;

describe('loadDockerTemplates', () => {
  it('maps each config entry to a provider-agnostic template', () => {
    const path = writeTemplates(VALID);

    const templates = loadDockerTemplates(path);

    expect(templates).toEqual([
      {
        key: 'docker-ubuntu22-2vcpu',
        labels: ['ubuntu22', 'ubuntu22-2vcpu'],
        maxConcurrency: 100,
        targetConcurrency: 0,
        cost: 2,
        spec: {image: 'shipfox-runner:ubuntu22', cpu: 2, memory: '4GiB'},
      },
      {
        key: 'docker-ubuntu22-4vcpu',
        labels: ['ubuntu22', 'ubuntu22-4vcpu'],
        maxConcurrency: 50,
        targetConcurrency: 0,
        cost: 6,
        spec: {image: 'shipfox-runner:ubuntu22', cpu: 4, memory: '8GiB'},
      },
    ]);
  });

  it('defaults the image to the published Shipfox runner', () => {
    const path = writeTemplates(`
templates:
  docker-ubuntu22:
    labels: [ubuntu22]
    cpu: 1
    memory: 2g
    max_concurrency: 1
`);

    const [template] = loadDockerTemplates(path);

    expect(template?.spec.image).toBe(DEFAULT_RUNNER_IMAGE);
    expect(mocks.warn).toHaveBeenCalledWith(
      {filePath: path, templateKey: 'docker-ubuntu22', image: DEFAULT_RUNNER_IMAGE},
      'Docker template image omitted; using default runner image',
    );
  });

  it('canonicalizes labels (lowercase, dedupe, sort)', () => {
    const path = writeTemplates(`
templates:
  t:
    labels: [Ubuntu22, ubuntu22, ubuntu22-4cpu]
    image: img
    cpu: 1
    memory: 2g
    max_concurrency: 1
`);

    const [template] = loadDockerTemplates(path);

    expect(template?.labels).toEqual(['ubuntu22', 'ubuntu22-4cpu']);
  });

  it('throws when the file is missing', () => {
    expect(() => loadDockerTemplates(join(dir, 'missing.yaml'))).toThrow(DockerTemplateConfigError);
  });

  it('throws on malformed YAML', () => {
    const path = writeTemplates('templates: [unclosed');

    expect(() => loadDockerTemplates(path)).toThrow(DockerTemplateConfigError);
  });

  it('throws when no templates are declared', () => {
    const path = writeTemplates('templates: {}');

    expect(() => loadDockerTemplates(path)).toThrow('declares no templates');
  });

  it('throws on an invalid field with a path-scoped message', () => {
    const path = writeTemplates(`
templates:
  t:
    labels: [ubuntu22]
    image: img
    cpu: -1
    memory: 2g
    max_concurrency: 1
`);

    expect(() => loadDockerTemplates(path)).toThrow('cpu');
  });

  it('throws on an unknown template key with the file and template in the error', () => {
    const path = writeTemplates(`
templates:
  t:
    labels: [ubuntu22]
    image: img
    cpu: 1
    memory: 2g
    max_concurrency: 1
    unknown_field: true
`);

    expect(() => loadDockerTemplates(path)).toThrow(
      new RegExp(`Invalid Docker template config at ${path}: .*templates\\.t.*unknown_field`),
    );
  });

  it('throws on an unknown file key', () => {
    const path = writeTemplates(`${VALID}\nunknown: true`);

    expect(() => loadDockerTemplates(path)).toThrow('unknown');
  });

  it('throws on a memory value that is not a size', () => {
    const path = writeTemplates(`
templates:
  t:
    labels: [ubuntu22]
    image: img
    cpu: 1
    memory: potato
    max_concurrency: 1
`);

    expect(() => loadDockerTemplates(path)).toThrow('memory');
  });

  it('accepts a memory value with no unit as bytes', () => {
    const path = writeTemplates(`
templates:
  t:
    labels: [ubuntu22]
    image: img
    cpu: 1
    memory: "512"
    max_concurrency: 1
`);

    const [template] = loadDockerTemplates(path);
    expect(template?.spec.memory).toBe('512');
  });

  it('throws on a label that cannot be a runner label', () => {
    const path = writeTemplates(`
templates:
  t:
    labels: ["not a valid label"]
    image: img
    cpu: 1
    memory: 2g
    max_concurrency: 1
`);

    expect(() => loadDockerTemplates(path)).toThrow('invalid labels');
  });

  it('throws on a whitespace-only image', () => {
    const path = writeTemplates(`
templates:
  t:
    labels: [ubuntu22]
    image: "   "
    cpu: 1
    memory: 2g
    max_concurrency: 1
`);

    expect(() => loadDockerTemplates(path)).toThrow('image');
  });
});
