import {lstat, mkdir, readdir, realpath, rm} from 'node:fs/promises';
import {basename, dirname, isAbsolute, relative, resolve, sep} from 'node:path';

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:/;

/** Thrown when a checkout path cannot be safely placed inside the job workspace. */
export class CheckoutPathInvalidError extends Error {
  constructor(public readonly checkoutPath: unknown) {
    super(
      `Checkout path is invalid: ${String(checkoutPath)}. Paths must be relative, must not contain '..' or '.git', and must remain inside the job workspace.`,
    );
    this.name = 'CheckoutPathInvalidError';
  }
}

/** Thrown when a checkout would overwrite content that this job does not own. */
export class CheckoutDestinationOccupiedError extends Error {
  constructor(public readonly checkoutPath: string) {
    super(
      `Checkout destination is occupied: ${checkoutPath}. Set force to replace the existing contents.`,
    );
    this.name = 'CheckoutDestinationOccupiedError';
  }
}

export type CheckoutDestinationState = 'missing' | 'empty' | 'occupied';

/**
 * Checks the lexical part of a checkout path before it is joined to the workspace.
 * Backslashes are rejected as well as POSIX separators so a path has one portable
 * interpretation on every runner image.
 */
export function assertCheckoutPath(checkoutPath: unknown): asserts checkoutPath is string {
  if (typeof checkoutPath !== 'string' || checkoutPath.trim() === '') {
    throw new CheckoutPathInvalidError(checkoutPath);
  }

  if (
    checkoutPath.includes('\\') ||
    checkoutPath.includes('\0') ||
    checkoutPath.startsWith('/') ||
    checkoutPath.startsWith('\\') ||
    WINDOWS_DRIVE_PATH_RE.test(checkoutPath) ||
    isAbsolute(checkoutPath)
  ) {
    throw new CheckoutPathInvalidError(checkoutPath);
  }

  const segments = checkoutPath.split('/');
  if (segments.some((segment) => segment === '..' || isGitSegment(segment))) {
    throw new CheckoutPathInvalidError(checkoutPath);
  }
}

/** Resolves an absolute checkout destination and enforces the workspace boundary. */
export async function normalizeCheckoutDestination(
  jobWorkspace: string,
  destination: string,
  invalidPath: unknown = destination,
): Promise<string> {
  const resolvedWorkspace = await realpath(jobWorkspace);
  const resolvedCandidate = await resolveExistingPrefix(destination);

  if (
    !isWithin(resolvedWorkspace, resolvedCandidate) ||
    containsGitSegment(resolvedWorkspace, resolvedCandidate)
  ) {
    throw new CheckoutPathInvalidError(invalidPath);
  }

  return resolvedCandidate;
}

/**
 * Resolves a checkout destination under the real job workspace. The destination itself
 * may not exist yet, so realpath is walked up to the nearest existing ancestor. This
 * still catches a symlinked ancestor that would place a new checkout outside the job.
 */
export function resolveCheckoutPath(jobWorkspace: string, checkoutPath: unknown): Promise<string> {
  assertCheckoutPath(checkoutPath);

  const lexicalCandidate = resolve(jobWorkspace, checkoutPath);
  return normalizeCheckoutDestination(jobWorkspace, lexicalCandidate, checkoutPath);
}

export async function inspectCheckoutDestination(
  checkoutPath: string,
): Promise<CheckoutDestinationState> {
  let candidate: Awaited<ReturnType<typeof lstat>>;
  try {
    candidate = await lstat(checkoutPath);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) return 'missing';
    throw error;
  }

  if (!candidate.isDirectory()) return 'occupied';
  const entries = await readdir(checkoutPath);
  return entries.length === 0 ? 'empty' : 'occupied';
}

/** Creates a missing destination without touching existing contents. */
export async function createCheckoutDestination(checkoutPath: string): Promise<void> {
  await mkdir(checkoutPath, {recursive: true});
}

/** Replaces a destination after the executor has applied the never-overwrite rule. */
export async function replaceCheckoutDestination(checkoutPath: string): Promise<void> {
  await rm(checkoutPath, {recursive: true, force: true});
  await mkdir(checkoutPath, {recursive: true});
}

async function resolveExistingPrefix(candidate: string): Promise<string> {
  const missingSegments: string[] = [];
  let current = candidate;

  while (true) {
    try {
      const existing = await realpath(current);
      return resolve(existing, ...missingSegments.reverse());
    } catch (error) {
      if (isFileSystemError(error, 'ENOTDIR')) {
        throw new CheckoutPathInvalidError(candidate);
      }
      if (!isFileSystemError(error, 'ENOENT')) throw error;

      // A dangling symlink is not a missing checkout destination. Treating it as one
      // would allow mkdir/rm to follow an unexpected link during a later operation.
      await assertMissingPathIsNotDanglingSymlink(current, candidate);

      const parent = dirname(current);
      if (parent === current) throw new CheckoutPathInvalidError(candidate);
      missingSegments.push(basename(current));
      current = parent;
    }
  }
}

async function assertMissingPathIsNotDanglingSymlink(
  current: string,
  candidate: string,
): Promise<void> {
  try {
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new CheckoutPathInvalidError(candidate);
  } catch (error) {
    if (!isFileSystemError(error, 'ENOENT')) throw error;
  }
}

function containsGitSegment(parent: string, candidate: string): boolean {
  const distance = relative(parent, candidate);
  return distance.split(sep).some(isGitSegment);
}

function isGitSegment(segment: string): boolean {
  return segment.toLowerCase() === '.git';
}

function isWithin(parent: string, candidate: string): boolean {
  const distance = relative(parent, candidate);
  return (
    distance === '' ||
    (!distance.startsWith(`..${sep}`) && distance !== '..' && !isAbsolute(distance))
  );
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
  );
}
