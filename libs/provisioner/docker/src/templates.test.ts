import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_RUNNER_IMAGE, DockerTemplateConfigError, loadDockerTemplates} from '#templates.js';

const mocks = vi.hoisted(() => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn()}));
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => mocks}));

const SHADOWED_TEMPLATE_CPU_PATTERN = /templates\.docker-2-ubuntu22\.cpu/;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'provisioner-docker-'));
  mocks.debug.mockReset();
  mocks.info.mockReset();
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
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: 'provisioner.templates_loaded',
        filePath: path,
        templateCount: 2,
        familyCount: 0,
      },
      'Loaded 2 Docker templates from 0 matrix families',
    );
  });

  it('expands matrix families before validating Docker templates', () => {
    const path = writeTemplates(`
templates: {}
matrix:
  docker:
    axes:
      cpu: [2, 4]
      os: [ubuntu22, ubuntu24]
    template:
      labels: [docker, "\${{ os }}"]
      image: "shipfox-runner:\${{ os }}"
      cpu: "\${{ cpu }}"
      memory: "\${{ cpu * 2.0 }}GiB"
      max_concurrency: "\${{ cpu * 10.0 }}"
      cost: "\${{ cpu }}"
`);

    expect(loadDockerTemplates(path)).toEqual([
      {
        key: 'docker-2-ubuntu22',
        labels: ['docker', 'ubuntu22'],
        maxConcurrency: 20,
        targetConcurrency: 0,
        cost: 2,
        spec: {image: 'shipfox-runner:ubuntu22', cpu: 2, memory: '4GiB'},
      },
      {
        key: 'docker-2-ubuntu24',
        labels: ['docker', 'ubuntu24'],
        maxConcurrency: 20,
        targetConcurrency: 0,
        cost: 2,
        spec: {image: 'shipfox-runner:ubuntu24', cpu: 2, memory: '4GiB'},
      },
      {
        key: 'docker-4-ubuntu22',
        labels: ['docker', 'ubuntu22'],
        maxConcurrency: 40,
        targetConcurrency: 0,
        cost: 4,
        spec: {image: 'shipfox-runner:ubuntu22', cpu: 4, memory: '8GiB'},
      },
      {
        key: 'docker-4-ubuntu24',
        labels: ['docker', 'ubuntu24'],
        maxConcurrency: 40,
        targetConcurrency: 0,
        cost: 4,
        spec: {image: 'shipfox-runner:ubuntu24', cpu: 4, memory: '8GiB'},
      },
    ]);
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: 'provisioner.templates_loaded',
        filePath: path,
        templateCount: 4,
        familyCount: 1,
      },
      'Loaded 4 Docker templates from 1 matrix families',
    );
  });

  it('keeps a hand-written template when it shadows a generated key', () => {
    const path = writeTemplates(`
templates:
  docker-2-ubuntu22:
    labels: [hand-written]
    image: hand-written
    cpu: 99
    memory: 2g
    max_concurrency: 1
matrix:
  docker:
    axes:
      cpu: [2]
      os: [ubuntu22]
    template:
      labels: [generated]
      image: generated
      cpu: 2
      memory: 4g
      max_concurrency: 2
`);

    expect(loadDockerTemplates(path)).toEqual([
      {
        key: 'docker-2-ubuntu22',
        labels: ['hand-written'],
        maxConcurrency: 1,
        targetConcurrency: 0,
        cost: 99,
        spec: {image: 'hand-written', cpu: 99, memory: '2g'},
      },
    ]);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provisioner.template_generated_shadowed',
        templateKey: 'docker-2-ubuntu22',
      }),
      expect.stringContaining('shadowed'),
    );
  });

  it('validates generated templates before a hand-written shadow can hide them', () => {
    const path = writeTemplates(`
templates:
  docker-2-ubuntu22:
    labels: [hand-written]
    image: hand-written
    cpu: 99
    memory: 2g
    max_concurrency: 1
matrix:
  docker:
    axes:
      cpu: [2]
      os: [ubuntu22]
    template:
      labels: [generated]
      image: generated
      cpu: 0
      memory: 4g
      max_concurrency: 2
`);

    expect(() => loadDockerTemplates(path)).toThrow(SHADOWED_TEMPLATE_CPU_PATTERN);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('wraps core matrix errors in DockerTemplateConfigError', () => {
    const path = writeTemplates(`
templates: {}
matrix:
  docker:
    axes:
      cpu: []
    template: {}
`);

    expect(() => loadDockerTemplates(path)).toThrow(DockerTemplateConfigError);
    expect(() => loadDockerTemplates(path)).toThrow(
      new RegExp(`Invalid Docker template config at ${path}: Invalid template file`),
    );
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
    expect(mocks.debug).toHaveBeenCalledWith(
      {
        event: 'runner.default_image_selected',
        filePath: path,
        templateKey: 'docker-ubuntu22',
        image: DEFAULT_RUNNER_IMAGE,
      },
      'Docker template omitted image; selected ghcr.io/shipfoxhq/runner:latest as the default runner image',
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
