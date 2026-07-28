import {enumerateVariants, MAX_TEMPLATES, parseTemplateFile} from '#template-file.js';

const expression = (source: string) => `\${{ ${source} }}`;
const MULTI_BLOCK_ERROR_PATTERN =
  /matrix\.standard\.axes\.cpu.*matrix\.standard\.include\.0.*matrix\.gpu\.include\.0/s;
const INCOMPLETE_INCLUDE_PATTERN =
  /must bind every declared axis.*missing arch.*unknown axes: extra/s;

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
