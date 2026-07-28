import {
  enumerateVariants,
  MAX_TEMPLATES,
  parseTemplateFile,
  renderTemplateVariants,
} from '#template-file.js';

const observability = vi.hoisted(() => {
  const warningCalls: unknown[][] = [];
  return {
    logger: {warn: (...args: unknown[]) => warningCalls.push(args)},
    warningCalls,
  };
});

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => observability.logger}));

const expression = (source: string) => `\${{ ${source} }}`;
const MULTI_BLOCK_ERROR_PATTERN =
  /matrix\.standard\.axes\.cpu.*matrix\.standard\.include\.0.*matrix\.gpu\.include\.0/s;
const INCOMPLETE_INCLUDE_PATTERN =
  /must bind every declared axis.*missing arch.*unknown axes: extra/s;
const KEY_COLLISION_PATTERN = /key "4".*x64.*arm64.*differing axes: arch/s;
const OBJECT_AXIS_NAME_PATTERN = /machine.*name field/;
const RENDER_FAILURE_PATTERN =
  /2 variants failed in matrix `standard`.*template\.ami.*ubuntu2404.*ubuntu2604/s;

describe('parseTemplateFile', () => {
  it('preserves the existing hand-written file shape when matrix is absent', () => {
    const templates = {linux: {labels: ['linux']}};

    const parsed = parseTemplateFile({templates});

    expect(parsed).toEqual({templates});
  });

  it('parses shared vars, defaults, and expressions without evaluating them', () => {
    const parsed = parseTemplateFile({
      vars: {sizes: [2, 4]},
      defaults: {market: 'spot'},
      templates: {},
      matrix: {
        standard: {
          axes: {cpu: expression('vars.sizes')},
          template: {cpu: expression('cpu')},
          let: {double_cpu: expression('cpu * 2')},
          key: expression('string(cpu)'),
        },
      },
    });

    expect(parsed.vars).toEqual({sizes: [2, 4]});
    expect(parsed.defaults).toEqual({market: 'spot'});
    expect(parsed.matrix?.standard?.axes.cpu).toMatchObject({source: 'vars.sizes'});
    expect(parsed.matrix?.standard?.let.double_cpu).toMatchObject({source: 'cpu * 2'});
    expect(parsed.matrix?.standard?.key).toMatchObject({source: 'string(cpu)'});
    expect(parsed.matrix?.standard?.template.cpu).toEqual([
      expect.objectContaining({kind: 'expr', expression: expect.objectContaining({source: 'cpu'})}),
    ]);
  });

  it('reports structural errors from multiple blocks together', () => {
    expect(() =>
      parseTemplateFile({
        templates: {},
        matrix: {
          standard: {axes: {cpu: []}, template: {}, include: [{cpu: 1, extra: true}]},
          gpu: {axes: {arch: [1]}, template: {}, include: [{wrong: 'x'}]},
        },
      }),
    ).toThrow(MULTI_BLOCK_ERROR_PATTERN);
  });

  it('requires complete include bindings and rejects unknown axes', () => {
    expect(() =>
      parseTemplateFile({
        templates: {},
        matrix: {
          standard: {
            axes: {cpu: [2], arch: ['x64']},
            include: [{cpu: 4, extra: true}],
            template: {},
          },
        },
      }),
    ).toThrow(INCOMPLETE_INCLUDE_PATTERN);
  });
});

describe('enumerateVariants', () => {
  it('enumerates independent families in stable cartesian-product order', () => {
    const file = parseTemplateFile({
      templates: {one_off: {}},
      matrix: {
        standard: {
          axes: {arch: ['x64', 'arm64'], cpu: [2, 4]},
          exclude: [{arch: 'x64', cpu: 4}],
          include: [{arch: 'x64', cpu: 8}],
          template: {},
        },
        gpu: {
          axes: {model: ['a10', 'a100'], size: ['small', 'large']},
          template: {},
        },
      },
    });

    const variants = enumerateVariants(file);

    expect(variants).toEqual([
      {block: 'standard', bindings: {arch: 'x64', cpu: 2}},
      {block: 'standard', bindings: {arch: 'arm64', cpu: 2}},
      {block: 'standard', bindings: {arch: 'arm64', cpu: 4}},
      {block: 'standard', bindings: {arch: 'x64', cpu: 8}},
      {block: 'gpu', bindings: {model: 'a10', size: 'small'}},
      {block: 'gpu', bindings: {model: 'a10', size: 'large'}},
      {block: 'gpu', bindings: {model: 'a100', size: 'small'}},
      {block: 'gpu', bindings: {model: 'a100', size: 'large'}},
    ]);
  });

  it('applies partial excludes across all matching variants', () => {
    const file = parseTemplateFile({
      templates: {},
      matrix: {
        standard: {
          axes: {
            arch: ['x64', 'arm64'],
            cpu: [2, 4],
          },
          exclude: [{arch: 'x64'}],
          template: {},
        },
      },
    });

    expect(enumerateVariants(file)).toEqual([
      {block: 'standard', bindings: {arch: 'arm64', cpu: 2}},
      {block: 'standard', bindings: {arch: 'arm64', cpu: 4}},
    ]);
  });

  it('preserves prototype-named matrix and axis keys', () => {
    const matrix = Object.fromEntries([
      [
        '__proto__',
        {
          axes: Object.fromEntries([['__proto__', ['x64']]]),
          template: {},
        },
      ],
    ]);
    const file = parseTemplateFile({templates: {}, matrix});

    expect(Object.keys(file.matrix ?? {})).toEqual(['__proto__']);
    expect(enumerateVariants(file)).toEqual([
      {
        block: '__proto__',
        bindings: Object.fromEntries([['__proto__', 'x64']]),
      },
    ]);
  });

  it('evaluates expression axes against file vars and requires a non-empty list', () => {
    const file = parseTemplateFile({
      vars: {cpus: [2, 4]},
      templates: {},
      matrix: {
        standard: {
          axes: {cpu: expression('vars.cpus')},
          template: {},
        },
      },
    });

    expect(enumerateVariants(file)).toEqual([
      {block: 'standard', bindings: {cpu: 2}},
      {block: 'standard', bindings: {cpu: 4}},
    ]);

    const empty = parseTemplateFile({
      templates: {},
      matrix: {standard: {axes: {cpu: expression('[]')}, template: {}}},
    });
    expect(() => enumerateVariants(empty)).toThrow('axis "cpu" must not be empty');
  });

  it('uses the scoped range evaluator for generated axes', () => {
    const file = parseTemplateFile({
      templates: {},
      matrix: {
        standard: {
          axes: {cpu: expression('range(2, 6, 2)')},
          template: {},
        },
      },
    });

    expect(enumerateVariants(file).map(({bindings}) => bindings)).toEqual([
      {cpu: 2n},
      {cpu: 4n},
      {cpu: 6n},
    ]);
  });

  it('counts all blocks and hand-written templates before materializing variants', () => {
    const file = parseTemplateFile({
      templates: {one_off: {}},
      matrix: {
        standard: {axes: {cpu: Array.from({length: MAX_TEMPLATES}, (_, i) => i)}, template: {}},
        gpu: {axes: {model: ['a']}, template: {}},
      },
    });

    expect(() => enumerateVariants(file)).toThrow(
      `matrix expands to ${MAX_TEMPLATES + 1} templates (standard: ${MAX_TEMPLATES}, gpu: 1) plus 1 hand-written; the maximum is ${MAX_TEMPLATES}`,
    );
  });
});

describe('renderTemplateVariants', () => {
  beforeEach(() => {
    observability.warningCalls.length = 0;
  });

  it('renders independent families with defaults, overrides, and declaration-order lets', () => {
    const file = parseTemplateFile({
      vars: {image: 'runner:latest'},
      defaults: {
        image: expression('vars.image'),
        labels: ['default'],
        nested: {from_defaults: true, shared: 'default'},
      },
      templates: {
        one_off: {labels: ['one-off'], nested: {from_defaults: false}},
      },
      matrix: {
        standard: {
          axes: {arch: ['arm64'], cpu: [6], os: ['ubuntu2404']},
          let: {memory: expression('cpu * 4.0')},
          template: {
            cpu: expression('cpu'),
            memory: expression('memory'),
            labels: ['standard'],
            nested: {shared: 'standard'},
          },
        },
        gpu: {
          axes: {model: [{name: 'a10'}], size: ['small']},
          template: {model: expression('model.name')},
        },
      },
    });

    const templates = renderTemplateVariants(file);

    expect(templates).toEqual({
      one_off: {
        image: 'runner:latest',
        labels: ['one-off'],
        nested: {from_defaults: false, shared: 'default'},
      },
      'standard-arm64-6-ubuntu2404': {
        image: 'runner:latest',
        labels: ['standard'],
        nested: {from_defaults: true, shared: 'standard'},
        cpu: 6,
        memory: 24,
      },
      'gpu-a10-small': {
        image: 'runner:latest',
        labels: ['default'],
        nested: {from_defaults: true, shared: 'default'},
        model: 'a10',
      },
    });
  });

  it('widens generated keys when an axis is added', () => {
    const withoutOs = parseTemplateFile({
      templates: {},
      matrix: {standard: {axes: {arch: ['x64'], cpu: [4]}, template: {}}},
    });
    const withOs = parseTemplateFile({
      templates: {},
      matrix: {
        standard: {axes: {arch: ['x64'], cpu: [4], os: ['ubuntu2404']}, template: {}},
      },
    });

    expect(Object.keys(renderTemplateVariants(withoutOs))).toEqual(['standard-x64-4']);
    expect(Object.keys(renderTemplateVariants(withOs))).toEqual(['standard-x64-4-ubuntu2404']);
  });

  it('keeps default keys distinct when axis values contain the separator', () => {
    const file = parseTemplateFile({
      templates: {},
      matrix: {
        standard: {
          axes: {left: ['a-b', 'a'], right: ['c', 'b-c']},
          template: {},
        },
      },
    });

    expect(Object.keys(renderTemplateVariants(file))).toEqual([
      'standard-a%2Db-c',
      'standard-a%2Db-b%2Dc',
      'standard-a-c',
      'standard-a-b%2Dc',
    ]);
  });

  it('rejects collisions from an explicit key override and names differing axes', () => {
    const file = parseTemplateFile({
      templates: {},
      matrix: {
        standard: {
          axes: {arch: ['x64', 'arm64'], cpu: [4]},
          key: expression('string(cpu)'),
          template: {},
        },
      },
    });

    expect(() => renderTemplateVariants(file)).toThrow(KEY_COLLISION_PATTERN);
  });

  it('requires names for object-valued axes only when deriving the default key', () => {
    const withoutName = parseTemplateFile({
      templates: {},
      matrix: {standard: {axes: {machine: [{id: 'a'}]}, template: {}}},
    });
    expect(() => renderTemplateVariants(withoutName)).toThrow(OBJECT_AXIS_NAME_PATTERN);

    const explicitKey = parseTemplateFile({
      templates: {},
      matrix: {
        standard: {
          axes: {machine: [{id: 'a'}]},
          key: expression("'custom-machine'"),
          template: {machine: expression('machine.id')},
        },
      },
    });
    expect(renderTemplateVariants(explicitKey)).toEqual({
      'custom-machine': {machine: 'a'},
    });
  });

  it('preserves opaque arrays that resemble workflow template segments', () => {
    const opaqueSegments = [
      {kind: 'literal', text: 'keep me'},
      {kind: 'expr', expression: {source: 'cpu'}},
    ];
    const file = parseTemplateFile({
      templates: {},
      matrix: {
        standard: {
          axes: {cpu: [4]},
          template: {provider_spec: opaqueSegments},
        },
      },
    });

    expect(renderTemplateVariants(file)).toEqual({
      'standard-4': {provider_spec: opaqueSegments},
    });
  });

  it('lets hand-written templates shadow generated twins and warns', () => {
    const file = parseTemplateFile({
      templates: {'standard-x64-4': {cpu: 99}},
      matrix: {
        standard: {axes: {arch: ['x64'], cpu: [4]}, template: {cpu: expression('cpu')}},
      },
    });

    expect(renderTemplateVariants(file)).toEqual({'standard-x64-4': {cpu: 99}});
    expect(observability.warningCalls).toHaveLength(1);
    expect(observability.warningCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        event: 'provisioner.template_generated_shadowed',
        templateKey: 'standard-x64-4',
      }),
    );
    expect(observability.warningCalls[0]?.[1]).toEqual(expect.stringContaining('shadowed'));
  });

  it('aggregates rendering failures across variants in one block', () => {
    const file = parseTemplateFile({
      vars: {ami_by_os: {ubuntu2204: 'ami-2204'}},
      templates: {},
      matrix: {
        standard: {
          axes: {os: ['ubuntu2204', 'ubuntu2404', 'ubuntu2604']},
          template: {ami: expression('vars.ami_by_os[os]')},
        },
      },
    });

    expect(() => renderTemplateVariants(file)).toThrow(RENDER_FAILURE_PATTERN);
  });
});
