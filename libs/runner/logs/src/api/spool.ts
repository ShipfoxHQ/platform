import {closeSync, mkdirSync, openSync, readSync, statSync, writeSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {isUuid} from '@shipfox/regex';
import {InvalidStepIdError} from '#core/errors.js';

const EMPTY = Buffer.alloc(0);

// Record delimiter. A raw 0x0a only ever ends a record: the framer escapes any
// newline inside a payload (JSON.stringify emits `\n`, two chars), so the last one
// in a window is the boundary of the last complete record.
const NEWLINE = 0x0a;

/**
 * Per-attempt append-only NDJSON spool. Writes are synchronous (`writeSync`):
 * the runner runs one job at a time, so a small blocking append is cheaper than
 * an in-memory write queue and it puts bytes in the OS page cache before the
 * uploader reads them. Durability against machine death comes from the server
 * ack, not local fsync; the page cache survives a runner-process restart.
 */
export class AttemptSpool {
  private appendFd: number | undefined;
  private readFd: number | undefined;
  private _length = 0;

  private constructor(private readonly filePath: string) {
    // Seed length from bytes already on disk (a reopened attempt after a process restart) so
    // reads, append offsets, and the uploader's server-ahead check are all correct before the
    // first append opens the fd. A fresh attempt's file is absent, so length stays 0.
    try {
      this._length = statSync(filePath).size;
    } catch (error) {
      // ENOENT is the common fresh-attempt case (no file yet) and is fine. Any other stat
      // error means a broken path that would otherwise look like an empty resume and silently
      // diverge the offset state, so rethrow it; the caller treats a spool-open failure as
      // abandoned capture and runs the step without logs.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  static open(logsDir: string, stepId: string, attempt: number): AttemptSpool {
    if (!isUuid(stepId)) throw new InvalidStepIdError(stepId);
    return new AttemptSpool(join(logsDir, `${stepId}-${attempt}.ndjson`));
  }

  get length(): number {
    return this._length;
  }

  append(bytes: Buffer): void {
    if (bytes.length === 0) return;
    const fd = this.ensureAppendFd();
    // writeSync can return a short count: a non-error partial write (an EINTR after some
    // bytes, or a filesystem filling mid-write). Loop until the whole buffer lands so
    // _length never drifts ahead of the file (which would tear the offset-addressed stream).
    // A real out-of-space surfaces as the next call throwing ENOSPC, which the caller turns
    // into failStream. A zero-byte return with no error is impossible for a regular file, so
    // treat it as fatal rather than spin forever.
    let written = 0;
    while (written < bytes.length) {
      const n = writeSync(fd, bytes, written, bytes.length - written);
      if (n === 0) {
        throw new Error(`Spool write made no progress at offset ${this._length + written}`);
      }
      written += n;
    }
    this._length += written;
  }

  /**
   * Reads whole NDJSON records starting at `offset`, up to `maxBytes` worth, never
   * past what has been written. The returned buffer ends on a record boundary (a
   * trailing `\n`). The uploader never ships a torn last line. The server never
   * commits one, so every committed offset stays parseable.
   *
   * Returns empty once caught up. The lone exception to the whole-record guarantee
   * is a single record larger than `maxBytes`: it is returned split rather than
   * stalling the uploader, and the offset-addressed byte stream heals the split
   * server-side once the remainder is appended.
   */
  read(offset: number, maxBytes: number): Buffer {
    const window = Math.min(maxBytes, this._length - offset);
    if (window <= 0) return EMPTY;
    const buffer = Buffer.allocUnsafe(window);
    const bytesRead = readSync(this.ensureReadFd(), buffer, 0, window, offset);
    const chunk = bytesRead === window ? buffer : buffer.subarray(0, bytesRead);

    const lastNewline = chunk.lastIndexOf(NEWLINE);
    return lastNewline === -1 ? chunk : chunk.subarray(0, lastNewline + 1);
  }

  close(): void {
    if (this.appendFd !== undefined) {
      closeSync(this.appendFd);
      this.appendFd = undefined;
    }
    if (this.readFd !== undefined) {
      closeSync(this.readFd);
      this.readFd = undefined;
    }
  }

  private ensureAppendFd(): number {
    if (this.appendFd === undefined) {
      mkdirSync(dirname(this.filePath), {recursive: true});
      // Append mode does not truncate, so the on-disk bytes _length was seeded from at
      // construction are preserved; opening 'a' here only attaches the write fd.
      this.appendFd = openSync(this.filePath, 'a');
    }
    return this.appendFd;
  }

  private ensureReadFd(): number {
    if (this.readFd === undefined) this.readFd = openSync(this.filePath, 'r');
    return this.readFd;
  }
}
