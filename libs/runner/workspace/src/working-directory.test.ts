import {mkdir, mkdtemp, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  resolveWorkingDirectory,
  WorkingDirectoryEscapeError,
  WorkingDirectoryNotDirectoryError,
  WorkingDirectoryNotFoundError,
} from '#working-directory.js';

const INVALID_WORKING_DIRECTORY_MESSAGE =
  /relative path without '..' segments or absolute path syntax/;

describe('resolveWorkingDirectory', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'shipfox-working-directory-'));
  });

  afterEach(async () => {
    await rm(workspace, {recursive: true, force: true});
  });

  it('defaults to the job workspace', async () => {
    await expect(resolveWorkingDirectory(workspace, undefined)).resolves.toBe(workspace);
  });

  it('resolves an existing nested directory without creating anything', async () => {
    const nested = join(workspace, 'api');
    await mkdir(nested);

    await expect(resolveWorkingDirectory(workspace, 'api')).resolves.toBe(await realpath(nested));
  });

  it.each([
    '../outside',
    '/tmp/outside',
    'C:\\outside',
    'api/../outside',
  ])('rejects unsafe path syntax: %s', async (workingDirectory) => {
    await expect(resolveWorkingDirectory(workspace, workingDirectory)).rejects.toThrow(
      INVALID_WORKING_DIRECTORY_MESSAGE,
    );
  });

  it('fails clearly when the directory is missing', async () => {
    await expect(resolveWorkingDirectory(workspace, 'missing')).rejects.toThrow(
      WorkingDirectoryNotFoundError,
    );
    await expect(resolveWorkingDirectory(workspace, 'missing')).rejects.toThrow(
      'Working directory does not exist: missing',
    );
  });

  it('fails when the path resolves to a file', async () => {
    await writeFile(join(workspace, 'file.txt'), 'content');

    await expect(resolveWorkingDirectory(workspace, 'file.txt')).rejects.toThrow(
      WorkingDirectoryNotDirectoryError,
    );
  });

  it('rejects a symlink that resolves outside the job workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'shipfox-working-directory-outside-'));
    try {
      await symlink(outside, join(workspace, 'escape'));

      await expect(resolveWorkingDirectory(workspace, 'escape')).rejects.toThrow(
        WorkingDirectoryEscapeError,
      );
    } finally {
      await rm(outside, {recursive: true, force: true});
    }
  });
});
