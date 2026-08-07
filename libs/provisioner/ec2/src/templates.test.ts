import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import {Ec2TemplateConfigError, loadEc2Templates} from '#templates.js';

const observability = vi.hoisted(() => ({logger: {warn: vi.fn()}}));
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => observability.logger}));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'provisioner-ec2-'));
  observability.logger.warn.mockReset();
});

afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function writeTemplates(contents: string): string {
  const path = join(dir, `${randomUUID()}.yaml`);
  writeFileSync(path, contents);
  return path;
}

const expression = (source: string) => `\${{ ${source} }}`;
const EXAMPLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/provisioner-ec2/templates.example.yaml',
);

function template(overrides: Record<string, string> = {}, extra = ''): string {
  const defaults = `
templates:
  t:
    labels: [ubuntu22]
    ami: ami-0123456789abcdef0
    instance_type: m6i.large
    market: spot
    spot_max_price: 0.05
    subnets: [subnet-aaa]
    security_groups: [sg-runner]
    associate_public_ip: false
    root_volume_gb: 100
    max_concurrency: 100
    cost: 5
`;

  return (
    Object.entries(overrides).reduce(
      (contents, [field, value]) =>
        contents.replace(new RegExp(`^(\\s*${field}: ).*$`, 'm'), `$1${value}`),
      defaults,
    ) + extra
  );
}

const VALID = `
templates:
  ec2-ubuntu22-2vcpu-spot:
    labels: [ubuntu22, ubuntu22-2vcpu]
    ami: ami-0123456789abcdef0
    instance_type: m6i.large
    market: spot
    spot_max_price: 0.05
    subnets: [subnet-aaa, subnet-bbb]
    security_groups: [sg-runner]
    iam_instance_profile: shipfox-runner
    associate_public_ip: false
    root_volume_gb: 100
    max_concurrency: 200
    target_concurrency: 2
    cost: 5
  ec2-ubuntu22-2vcpu-on-demand:
    labels: [ubuntu22, ubuntu22-2vcpu-on-demand]
    ami: ami-0123456789abcdef1
    instance_type: m6i.large
    market: on-demand
    subnets: [subnet-ccc]
    security_groups: [sg-runner]
    associate_public_ip: true
    root_volume_gb: 120
    max_concurrency: 50
    cost: 10
`;

describe('loadEc2Templates', () => {
  it('loads the checked-in two-family example file', () => {
    const templates = loadEc2Templates(EXAMPLE_PATH);

    expect(templates).toHaveLength(11);
    expect(templates.filter(({key}) => key.startsWith('general-'))).toHaveLength(8);
    expect(templates.filter(({key}) => key.startsWith('gpu-'))).toHaveLength(2);
    expect(templates[0]).toMatchObject({
      key: 'ec2-one-off-debug',
      cost: 1,
      spec: {market: 'on-demand', subnets: ['subnet-general-a']},
    });
    expect(templates.find(({key}) => key === 'general-x64-4-ubuntu2204')).toMatchObject({
      spec: {
        market: 'on-demand',
        subnets: ['subnet-general-a', 'subnet-general-b'],
      },
    });
    expect(templates.find(({key}) => key === 'gpu-a10-cuda12')).toMatchObject({
      cost: 25,
      spec: {
        market: 'spot',
        subnets: ['subnet-gpu'],
        securityGroups: ['sg-gpu'],
      },
    });
  });

  it('maps each config entry to a provider-agnostic template', () => {
    const path = writeTemplates(VALID);

    const templates = loadEc2Templates(path);

    expect(templates).toEqual([
      {
        key: 'ec2-ubuntu22-2vcpu-spot',
        labels: ['ubuntu22', 'ubuntu22-2vcpu'],
        maxConcurrency: 200,
        targetConcurrency: 2,
        cost: 5,
        spec: {
          ami: 'ami-0123456789abcdef0',
          instanceType: 'm6i.large',
          market: 'spot',
          spotMaxPrice: 0.05,
          subnets: ['subnet-aaa', 'subnet-bbb'],
          securityGroups: ['sg-runner'],
          iamInstanceProfile: 'shipfox-runner',
          associatePublicIp: false,
          rootVolumeGb: 100,
          rootDeviceName: '/dev/sda1',
        },
      },
      {
        key: 'ec2-ubuntu22-2vcpu-on-demand',
        labels: ['ubuntu22', 'ubuntu22-2vcpu-on-demand'],
        maxConcurrency: 50,
        cost: 10,
        spec: {
          ami: 'ami-0123456789abcdef1',
          instanceType: 'm6i.large',
          market: 'on-demand',
          spotMaxPrice: null,
          subnets: ['subnet-ccc'],
          securityGroups: ['sg-runner'],
          associatePublicIp: true,
          rootVolumeGb: 120,
          rootDeviceName: '/dev/sda1',
        },
      },
    ]);
  });

  it('warns when a template has no IAM instance profile', () => {
    const path = writeTemplates(template());

    loadEc2Templates(path);

    expect(observability.logger.warn).toHaveBeenCalledWith(
      {
        event: 'provisioner.ec2_template_missing_iam_instance_profile',
        filePath: path,
        templateKey: 't',
        capability: 'host_debugging_over_aws_systems_manager',
      },
      'EC2 template "t" has no IAM instance profile; host debugging over AWS Systems Manager is unavailable',
    );
  });

  it('does not warn when a template has an IAM instance profile', () => {
    const path = writeTemplates(template({}, '    iam_instance_profile: shipfox-runner\n'));

    loadEc2Templates(path);

    expect(observability.logger.warn).not.toHaveBeenCalled();
  });

  it('accepts a null spot price', () => {
    const path = writeTemplates(template({spot_max_price: 'null'}));

    const [loaded] = loadEc2Templates(path);

    expect(loaded?.spec.spotMaxPrice).toBeNull();
  });

  it('uses the default root device name and preserves an explicit value', () => {
    const path = writeTemplates(template({}, '    root_device_name: /dev/xvda\n'));

    const templates = loadEc2Templates(path);

    expect(templates[0]?.spec.rootDeviceName).toBe('/dev/xvda');
    expect(loadEc2Templates(writeTemplates(template()))[0]?.spec.rootDeviceName).toBe('/dev/sda1');
  });

  it('canonicalizes labels (lowercase, dedupe, sort)', () => {
    const path = writeTemplates(template({labels: '[Ubuntu22, ubuntu22, ubuntu22-4cpu]'}));

    const [loaded] = loadEc2Templates(path);

    expect(loaded?.labels).toEqual(['ubuntu22', 'ubuntu22-4cpu']);
  });

  it('throws when the file is missing', () => {
    expect(() => loadEc2Templates(join(dir, 'missing.yaml'))).toThrow(Ec2TemplateConfigError);
  });

  it('throws on malformed YAML', () => {
    const path = writeTemplates('templates: [unclosed');

    expect(() => loadEc2Templates(path)).toThrow(Ec2TemplateConfigError);
  });

  it('throws when no templates are declared', () => {
    const path = writeTemplates('templates: {}');

    expect(() => loadEc2Templates(path)).toThrow('declares no templates');
  });

  it.each([
    ['ami', {ami: 'ami-invalid'}],
    ['instance_type', {instance_type: '"   "'}],
    ['market', {market: 'reserved'}],
    ['spot_max_price', {spot_max_price: '0'}],
    ['subnets', {subnets: '[]'}],
    ['security_groups', {security_groups: '[]'}],
    ['associate_public_ip', {associate_public_ip: '"false"'}],
    ['root_volume_gb', {root_volume_gb: '-1'}],
    ['max_concurrency', {max_concurrency: '0'}],
    ['cost', {cost: '0'}],
  ])('throws when %s is invalid', (field, override) => {
    const path = writeTemplates(template(override));

    expect(() => loadEc2Templates(path)).toThrow(field);
  });

  it('throws when iam_instance_profile is blank', () => {
    const path = writeTemplates(template({}, '    iam_instance_profile: "   "\n'));

    expect(() => loadEc2Templates(path)).toThrow('iam_instance_profile');
  });

  it('throws when root_device_name is blank', () => {
    const path = writeTemplates(template({}, '    root_device_name: "   "\n'));

    expect(() => loadEc2Templates(path)).toThrow('root_device_name');
  });

  it('throws when max_concurrency exceeds the limit', () => {
    const path = writeTemplates(template({max_concurrency: '100001'}));

    expect(() => loadEc2Templates(path)).toThrow('max_concurrency');
  });

  it('throws on a label that cannot be a runner label', () => {
    const path = writeTemplates(template({labels: '["not a valid label"]'}));

    expect(() => loadEc2Templates(path)).toThrow('invalid labels');
  });

  it('throws when labels are empty after normalization', () => {
    const path = writeTemplates(template({labels: '["  "]'}));

    expect(() => loadEc2Templates(path)).toThrow('no usable labels');
  });

  it('throws when there are more labels than allowed', () => {
    const labels = Array.from({length: MAX_RUNNER_LABELS + 1}, (_, index) => `label-${index}`);
    const path = writeTemplates(template({labels: `[${labels.join(', ')}]`}));

    expect(() => loadEc2Templates(path)).toThrow(`the maximum is ${MAX_RUNNER_LABELS}`);
  });

  it('throws when on-demand includes a spot price', () => {
    const path = writeTemplates(template({market: 'on-demand'}));

    expect(() => loadEc2Templates(path)).toThrow('spot_max_price');
  });

  it('throws on an unknown template key', () => {
    const path = writeTemplates(template({}, '    spot_maxprice: 0.05\n'));

    expect(() => loadEc2Templates(path)).toThrow('spot_maxprice');
  });

  it('throws on an unknown file key', () => {
    const path = writeTemplates(`${VALID}\nunknown: true`);

    expect(() => loadEc2Templates(path)).toThrow('unknown');
  });

  it('expands a matrix and resolves EC2 fields through operator-supplied lookup maps', () => {
    const path = writeTemplates(`
vars:
  ami_by_arch_os:
    arm64:
      ubuntu2204: ami-0aaa
      ubuntu2404: ami-0aab
    x64:
      ubuntu2204: ami-0baa
      ubuntu2404: ami-0bab
  cpu_family_by:
    arm64:
      4: m7g
    x64:
      4: m7i
  size_by_cpu:
    4: xlarge
templates: {}
matrix:
  standard:
    axes:
      arch: [arm64, x64]
      cpu: [4]
      ratio: [4]
      os: [ubuntu2204, ubuntu2404]
    template:
      labels: ["ec2-${expression('arch')}-${expression('cpu')}-${expression('ratio')}-${expression('os')}"]
      ami: "${expression('vars.ami_by_arch_os[arch][os]')}"
      instance_type: "${expression('vars.cpu_family_by[arch][ratio]')}.${expression('vars.size_by_cpu[cpu]')}"
      market: spot
      spot_max_price: 0.05
      subnets: [subnet-aaa]
      security_groups: [sg-runner]
      associate_public_ip: false
      root_volume_gb: 100
      max_concurrency: 100
      cost: 5
`);

    const templates = loadEc2Templates(path);

    expect(templates).toHaveLength(4);
    expect(templates.map(({key}) => key)).toEqual([
      'standard-arm64-4-4-ubuntu2204',
      'standard-arm64-4-4-ubuntu2404',
      'standard-x64-4-4-ubuntu2204',
      'standard-x64-4-4-ubuntu2404',
    ]);
    expect(templates.map(({spec}) => ({ami: spec.ami, instanceType: spec.instanceType}))).toEqual([
      {ami: 'ami-0aaa', instanceType: 'm7g.xlarge'},
      {ami: 'ami-0aab', instanceType: 'm7g.xlarge'},
      {ami: 'ami-0baa', instanceType: 'm7i.xlarge'},
      {ami: 'ami-0bab', instanceType: 'm7i.xlarge'},
    ]);
  });

  it('aggregates missing lookup keys with matrix bindings and field paths', () => {
    const path = writeTemplates(`
vars:
  ami_by_arch_os:
    arm64:
      ubuntu2204: ami-0aaa
    x64:
      ubuntu2204: ami-0baa
templates: {}
matrix:
  standard:
    axes:
      arch: [arm64, x64]
      os: [ubuntu2204, ubuntu2404]
    template:
      labels: ["ec2-${expression('arch')}-${expression('os')}"]
      ami: "${expression('vars.ami_by_arch_os[arch][os]')}"
      instance_type: m7g.xlarge
      market: spot
      spot_max_price: 0.05
      subnets: [subnet-aaa]
      security_groups: [sg-runner]
      associate_public_ip: false
      root_volume_gb: 100
      max_concurrency: 100
      cost: 5
`);

    let error: unknown;
    try {
      loadEc2Templates(path);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Ec2TemplateConfigError);
    expect(error).toHaveProperty(
      'message',
      expect.stringContaining('2 variants failed in matrix `standard`'),
    );
    expect(error).toHaveProperty('message', expect.stringContaining('template.ami'));
    expect(error).toHaveProperty('message', expect.stringContaining('"arch":"arm64"'));
    expect(error).toHaveProperty('message', expect.stringContaining('"arch":"x64"'));
    expect(error).toHaveProperty('message', expect.stringContaining('"os":"ubuntu2404"'));
  });
});
