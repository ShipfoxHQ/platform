/** The append offset is ahead of the committed length: the runner must rewind its spool cursor. */
export class OffsetGapError extends Error {
  constructor(public readonly committedLength: number) {
    super(`Append offset is ahead of the committed length (${committedLength})`);
    this.name = 'OffsetGapError';
  }
}

/**
 * The append body is not whole, newline-terminated records of the raw log
 * record contract. `forgedType` is set only for the detectable forgery case: a
 * line that is a valid server-only record (`capped`/`runner_lost`) under the read
 * union but is not valid on the raw write path. The append path can emit a
 * narrowed audit warning without logging the payload.
 */
export class MalformedLogChunkError extends Error {
  constructor(
    message: string,
    public readonly forgedType?: string,
  ) {
    super(message);
    this.name = 'MalformedLogChunkError';
  }
}

/**
 * The lease's `(workspaceId, projectId, workflowRunAttemptId)` does not match the values
 * stamped on the existing stream row. Since these are functionally determined
 * by `jobId` via workflows FKs, a mismatch implies a forged token or a
 * cross-job lease confusion. It is never a legitimate request.
 */
export class LeaseStreamMismatchError extends Error {
  constructor() {
    super('Lease identity does not match the existing stream row');
    this.name = 'LeaseStreamMismatchError';
  }
}
