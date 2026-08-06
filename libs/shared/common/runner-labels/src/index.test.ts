import {
  canonicalizeLabels,
  findInvalidLabels,
  MAX_RUNNER_LABEL_LENGTH,
  parseLabelList,
  parseRunnerCatalog,
  resolveRunnerLabels,
} from './index.js';

describe('canonicalizeLabels', () => {
  it('trims, lowercases, deduplicates, sorts, and drops empty labels', () => {
    const labels = canonicalizeLabels([' Ubuntu-Latest ', 'node-22', '', 'ubuntu-latest', ' GPU']);

    expect(labels).toEqual(['gpu', 'node-22', 'ubuntu-latest']);
  });

  it('treats a string as a single label', () => {
    const labels = canonicalizeLabels(' Ubuntu-Latest ');

    expect(labels).toEqual(['ubuntu-latest']);
  });

  it('treats undefined as an empty label set', () => {
    const labels = canonicalizeLabels(undefined);

    expect(labels).toEqual([]);
  });
});

describe('parseLabelList', () => {
  it('splits comma-delimited values before canonicalizing', () => {
    const labels = parseLabelList('ubuntu-latest, Node-22,ubuntu-latest,,gpu ');

    expect(labels).toEqual(['gpu', 'node-22', 'ubuntu-latest']);
  });

  it('parses an empty string as an empty label set', () => {
    const labels = parseLabelList('');

    expect(labels).toEqual([]);
  });
});

describe('findInvalidLabels', () => {
  it('accepts labels in the supported grammar', () => {
    const invalid = findInvalidLabels(['ubuntu-22.04', 'ubuntu_x64', 'node22']);

    expect(invalid).toEqual([]);
  });

  it('accepts labels at the maximum length', () => {
    const invalid = findInvalidLabels(['a'.repeat(MAX_RUNNER_LABEL_LENGTH)]);

    expect(invalid).toEqual([]);
  });

  it('returns labels with unsupported characters or length', () => {
    const overLength = 'a'.repeat(MAX_RUNNER_LABEL_LENGTH + 1);

    const invalid = findInvalidLabels(['ci,gpu', 'has space', 'has\nnewline', overLength]);

    expect(invalid).toEqual(['ci,gpu', 'has space', 'has\nnewline', overLength]);
  });
});

describe('parseRunnerCatalog', () => {
  it('canonicalizes names and labels', () => {
    const catalog = parseRunnerCatalog({
      ' ShipFox-4CPU ': [' OS.Ubuntu-Latest ', 'CPU.4'],
    });

    expect(catalog).toEqual({
      'shipfox-4cpu': ['cpu.4', 'os.ubuntu-latest'],
    });
  });

  it('accepts an empty catalog', () => {
    const catalog = parseRunnerCatalog({});

    expect(catalog).toEqual({});
  });

  it('rejects an invalid name', () => {
    const parse = () => parseRunnerCatalog({'not a name': ['label']});

    expect(parse).toThrow('invalid name');
  });

  it('rejects a name that canonicalizes to nothing', () => {
    const parse = () => parseRunnerCatalog({'   ': ['label']});

    expect(parse).toThrow('must not be empty');
  });

  it('rejects a name over the length limit', () => {
    const overLength = 'a'.repeat(MAX_RUNNER_LABEL_LENGTH + 1);
    const parse = () => parseRunnerCatalog({[overLength]: ['label']});

    expect(parse).toThrow('invalid name');
  });

  it('rejects two names that canonicalize to the same value', () => {
    const parse = () => parseRunnerCatalog({'ShipFox-4CPU': ['cpu.4'], 'shipfox-4cpu': ['cpu.8']});

    expect(parse).toThrow('duplicate name');
  });

  it('rejects an invalid label', () => {
    const parse = () => parseRunnerCatalog({name: ['not a label']});

    expect(parse).toThrow('invalid label');
  });

  it('rejects a label over the length limit', () => {
    const overLength = 'a'.repeat(MAX_RUNNER_LABEL_LENGTH + 1);
    const parse = () => parseRunnerCatalog({name: [overLength]});

    expect(parse).toThrow('invalid label');
  });

  it('rejects an entry with no labels', () => {
    const parse = () => parseRunnerCatalog({name: []});

    expect(parse).toThrow('at least one label');
  });

  it('rejects non-object input', () => {
    const parse = () => parseRunnerCatalog(null);

    expect(parse).toThrow('must be an object');
  });

  it.each([new Map(), new Date()])('rejects non-plain object input', (value) => {
    const parse = () => parseRunnerCatalog(value);

    expect(parse).toThrow('must be an object');
  });

  it('rejects an entry whose labels are not strings', () => {
    const parse = () => parseRunnerCatalog({name: ['label', 1]});

    expect(parse).toThrow('list of labels');
  });

  it('rejects sparse label arrays', () => {
    const sparseLabels = new Array<string>(1);
    const parse = () => parseRunnerCatalog({name: sparseLabels});

    expect(parse).toThrow('list of labels');
  });
});

describe('resolveRunnerLabels', () => {
  const catalog = parseRunnerCatalog({
    'shipfox-4cpu': ['os.ubuntu-latest', 'cpu.4'],
    'shipfox-arm64-4cpu': ['arch.arm64', 'cpu.4'],
  });

  it('resolves a known catalog name', () => {
    const labels = resolveRunnerLabels(['SHIPFOX-4CPU'], catalog);

    expect(labels).toEqual(['cpu.4', 'os.ubuntu-latest']);
  });

  it('passes an unknown name through as a label', () => {
    const labels = resolveRunnerLabels(['custom-runner'], catalog);

    expect(labels).toEqual(['custom-runner']);
  });

  it('keeps a free-form label alongside a catalog name', () => {
    const labels = resolveRunnerLabels(['shipfox-4cpu', 'internal-network'], catalog);

    expect(labels).toEqual(['cpu.4', 'internal-network', 'os.ubuntu-latest']);
  });

  it('unions labels from two catalog names', () => {
    const labels = resolveRunnerLabels(['shipfox-4cpu', 'shipfox-arm64-4cpu'], catalog);

    expect(labels).toEqual(['arch.arm64', 'cpu.4', 'os.ubuntu-latest']);
  });

  it('passes labels through with an empty catalog', () => {
    const labels = resolveRunnerLabels(['constructor'], {});

    expect(labels).toEqual(['constructor']);
  });

  it('returns no labels for an empty request', () => {
    const labels = resolveRunnerLabels([], catalog);

    expect(labels).toEqual([]);
  });

  it('resolves catalog entries once without recursion', () => {
    const labels = resolveRunnerLabels(['outer'], {outer: ['inner'], inner: ['label']});

    expect(labels).toEqual(['inner']);
  });
});
