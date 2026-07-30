const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const PATH_SEPARATOR = /[\\/]/;

export class InvalidWorkingDirectoryError extends Error {
  constructor(value: unknown) {
    super(
      `Invalid working_directory ${JSON.stringify(value)}: it must be a relative path without '..' segments or absolute path syntax.`,
    );
    this.name = 'InvalidWorkingDirectoryError';
  }
}

/**
 * Checks the path shape shared by the server dispatch boundary and the runner.
 * Filesystem containment is checked by the runner after resolving symlinks.
 */
export function assertWorkingDirectory(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidWorkingDirectoryError(value);
  }

  const isAbsolute =
    value.startsWith('/') || value.startsWith('\\') || WINDOWS_ABSOLUTE_PATH.test(value);
  const hasParentSegment = value.split(PATH_SEPARATOR).some((segment) => segment === '..');
  if (isAbsolute || hasParentSegment) {
    throw new InvalidWorkingDirectoryError(value);
  }
}
