import {realpath, stat} from 'node:fs/promises';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {assertWorkingDirectory} from '@shipfox/api-workflows-dto';

export class WorkingDirectoryNotFoundError extends Error {
  constructor(readonly workingDirectory: string) {
    super(`Working directory does not exist: ${workingDirectory}`);
    this.name = 'WorkingDirectoryNotFoundError';
  }
}

export class WorkingDirectoryNotDirectoryError extends Error {
  constructor(readonly workingDirectory: string) {
    super(`Working directory is not a directory: ${workingDirectory}`);
    this.name = 'WorkingDirectoryNotDirectoryError';
  }
}

export class WorkingDirectoryEscapeError extends Error {
  constructor(readonly workingDirectory: string) {
    super(`Working directory escapes the job workspace: ${workingDirectory}`);
    this.name = 'WorkingDirectoryEscapeError';
  }
}

/**
 * Resolves a step's working directory without creating it. The lexical shape is
 * checked before joining paths, and realpath containment prevents symlink escapes.
 */
export async function resolveWorkingDirectory(
  jobWorkspace: string,
  workingDirectory: unknown,
): Promise<string> {
  if (workingDirectory === undefined) return jobWorkspace;
  assertWorkingDirectory(workingDirectory);

  const resolvedWorkspace = await realpath(jobWorkspace);
  const resolvedCandidate = resolve(jobWorkspace, workingDirectory);
  let realCandidate: string;
  try {
    realCandidate = await realpath(resolvedCandidate);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      throw new WorkingDirectoryNotFoundError(workingDirectory);
    }
    throw error;
  }

  if (!isWithin(resolvedWorkspace, realCandidate)) {
    throw new WorkingDirectoryEscapeError(workingDirectory);
  }

  const candidateStats = await stat(realCandidate);
  if (!candidateStats.isDirectory()) {
    throw new WorkingDirectoryNotDirectoryError(workingDirectory);
  }
  return realCandidate;
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
