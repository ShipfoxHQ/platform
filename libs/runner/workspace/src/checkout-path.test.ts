import {mkdir, mkdtemp, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  assertCheckoutPath,
  CheckoutDestinationOccupiedError,
  CheckoutPathInvalidError,
  createCheckoutDestination,
  inspectCheckoutDestination,
  replaceCheckoutDestination,
  resolveCheckoutPath,
} from '#checkout-path.js';

describe('checkout destination paths', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'shipfox-checkout-path-'));
  });

  afterEach(async () => {
    await rm(workspace, {recursive: true, force: true});
  });

  it.each(['.', 'src/api'])('resolves safe relative paths: %s', async (checkoutPath) => {
    await expect(resolveCheckoutPath(workspace, checkoutPath)).resolves.toBe(
      checkoutPath === '.'
        ? await realpath(workspace)
        : join(await realpath(workspace), checkoutPath),
    );
  });

  it('resolves a destination whose final directory does not exist yet', async () => {
    await expect(resolveCheckoutPath(workspace, 'services/api')).resolves.toBe(
      join(await realpath(workspace), 'services/api'),
    );
  });

  it.each([
    '',
    '   ',
    '../outside',
    'src/../outside',
    '/tmp/outside',
    'C:outside',
    'C:\\outside',
    '.git',
    '.GIT',
    'src/.git',
    'src/.Git',
  ])('rejects unsafe checkout path syntax: %s', (checkoutPath) => {
    expect(() => assertCheckoutPath(checkoutPath)).toThrow(CheckoutPathInvalidError);
  });

  it('rejects a symlink whose resolved destination contains a case-variant Git directory', async () => {
    await mkdir(join(workspace, '.GIT', 'nested'), {recursive: true});
    await symlink(join('.GIT', 'nested'), join(workspace, 'alias'));

    const rejection = resolveCheckoutPath(workspace, 'alias');
    await expect(rejection).rejects.toBeInstanceOf(CheckoutPathInvalidError);
    await expect(rejection).rejects.toMatchObject({
      checkoutPath: 'alias',
    });
  });

  it('rejects a symlink that resolves outside the job workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'shipfox-checkout-outside-'));
    try {
      await symlink(outside, join(workspace, 'escape'));

      await expect(resolveCheckoutPath(workspace, 'escape')).rejects.toThrow(
        CheckoutPathInvalidError,
      );
    } finally {
      await rm(outside, {recursive: true, force: true});
    }
  });

  it('rejects a missing destination below an outside symlink', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'shipfox-checkout-outside-'));
    try {
      await symlink(outside, join(workspace, 'escape'));

      await expect(resolveCheckoutPath(workspace, 'escape/new')).rejects.toThrow(
        CheckoutPathInvalidError,
      );
    } finally {
      await rm(outside, {recursive: true, force: true});
    }
  });

  it('resolves an existing symlink that stays inside the job workspace', async () => {
    await mkdir(join(workspace, 'real-target'));
    await symlink('real-target', join(workspace, 'alias'));

    await expect(resolveCheckoutPath(workspace, 'alias')).resolves.toBe(
      await realpath(join(workspace, 'real-target')),
    );
  });

  it.each([
    {name: 'missing', expected: 'missing'},
    {name: 'empty', expected: 'empty'},
    {name: 'occupied', expected: 'occupied'},
  ] as const)('classifies a $name destination', async ({name, expected}) => {
    const destination = join(workspace, name);
    if (name === 'empty') await mkdir(destination);
    if (name === 'occupied') {
      await mkdir(destination);
      await writeFile(join(destination, 'agent-change.txt'), 'keep me');
    }

    await expect(inspectCheckoutDestination(destination)).resolves.toBe(expected);
  });

  it('creates a missing destination and force replacement removes all content', async () => {
    const destination = join(workspace, 'repo');
    await createCheckoutDestination(destination);
    await writeFile(join(destination, 'agent-change.txt'), 'discard me');

    await expect(inspectCheckoutDestination(destination)).resolves.toBe('occupied');
    await replaceCheckoutDestination(destination);
    await expect(inspectCheckoutDestination(destination)).resolves.toBe('empty');
  });

  it('exposes the occupied-destination error used by the executor', () => {
    expect(new CheckoutDestinationOccupiedError('/job/repo').message).toContain(
      'Checkout destination is occupied',
    );
  });
});
