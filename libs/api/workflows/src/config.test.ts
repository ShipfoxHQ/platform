import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRunnerCatalog} from './config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'api-workflows-'));
});

afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function writeCatalog(contents: string): string {
  const path = join(dir, `${randomUUID()}.yaml`);
  writeFileSync(path, contents);
  return path;
}

describe('loadRunnerCatalog', () => {
  it('returns an empty catalog when no path is configured', () => {
    expect(loadRunnerCatalog('')).toEqual({});
  });

  it.each([
    '',
    '# just a comment',
    '---\n',
  ])('treats an empty YAML document as empty', (contents) => {
    expect(loadRunnerCatalog(writeCatalog(contents))).toEqual({});
  });

  it('loads and validates a YAML catalog', () => {
    const path = writeCatalog(`
ShipFox-4CPU:
  - OS.Ubuntu-Latest
  - CPU.4
`);

    expect(loadRunnerCatalog(path)).toEqual({
      'shipfox-4cpu': ['cpu.4', 'os.ubuntu-latest'],
    });
  });

  it('includes the file path when the catalog file is missing', () => {
    const path = join(dir, 'missing.yaml');

    expect(() => loadRunnerCatalog(path)).toThrow(`Cannot read runner catalog config at ${path}`);
  });

  it('includes the file path when YAML is malformed', () => {
    const path = writeCatalog('runner: [unclosed');

    expect(() => loadRunnerCatalog(path)).toThrow(`Cannot parse runner catalog config at ${path}`);
  });

  it.each([
    ['bad name', 'label'],
    ['name', 'not a label'],
  ])('includes the file path when the catalog contains an invalid %s', (name, value) => {
    const path = writeCatalog(`${name}:\n  - ${value}\n`);

    expect(() => loadRunnerCatalog(path)).toThrow(`Invalid runner catalog config at ${path}`);
  });

  it('rejects oversized entries at startup', () => {
    const path = writeCatalog(
      `too-many:\n${Array.from({length: 21}, (_, index) => `  - label-${index}`).join('\n')}\n`,
    );

    expect(() => loadRunnerCatalog(path)).toThrow(
      `Runner catalog entry "too-many" in ${path} has 21 labels`,
    );
  });
});
