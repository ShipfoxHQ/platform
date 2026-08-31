import {Buffer} from 'node:buffer';
import {closeSync, openSync, readSync, statSync} from 'node:fs';
import {logger} from '@shipfox/node-opentelemetry';

const DEFAULT_POLL_INTERVAL_MS = 250;

// A 0x0a byte only ever terminates an entry: it never appears inside a multi-byte UTF-8
// sequence, so the bytes up to a newline are always a whole entry that decodes cleanly.
const NEWLINE = 0x0a;

export interface SessionForwarderOptions {
  filePath: string;
  onEntry: (line: string) => void;
  intervalMs?: number;
  /** Start reading after existing content, for a fork whose history was pre-seeded. */
  startAtEnd?: boolean;
}

export interface SessionForwarder {
  stop(): void;
}

/**
 * Tails a growing append-only JSONL file by byte offset and forwards each complete line.
 *
 * pi persists each session entry synchronously (appendFileSync) and may defer the first write
 * until the first assistant message, then bulk-write several lines at once: a byte-offset
 * reader handles both, where a line-index reader would not. A poll can observe a partial write
 * (a large entry spans several write() syscalls), so the carry buffer holds raw bytes, not a
 * decoded string: bytes are split on the newline and only whole lines are decoded, so a read
 * that ends mid-codepoint never turns the split character into U+FFFD.
 *
 * Capture is best-effort: a missing file (not yet written, or removed on workspace cleanup)
 * or a read error stops forwarding quietly without ever throwing into the caller.
 */
export function startSessionForwarder(options: SessionForwarderOptions): SessionForwarder {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let offset = 0;
  let pending = Buffer.alloc(0);
  if (options.startAtEnd) {
    try {
      offset = statSync(options.filePath).size;
    } catch {
      // The file may not exist until pi persists the first new entry.
    }
  }
  let stopped = false;

  function drainNewBytes(): void {
    let size: number;
    try {
      size = statSync(options.filePath).size;
    } catch {
      // File not present yet (pi defers the first write) or removed on cleanup.
      return;
    }
    // A file shorter than the byte offset was truncated or replaced (e.g. log rotation): the
    // offset now points past the end, so reset and re-read the new content from the start
    // instead of silently skipping it. pi only ever appends, so this is a defensive guard.
    if (size < offset) {
      offset = 0;
      pending = Buffer.alloc(0);
    }
    if (size <= offset) return;

    let fd: number;
    try {
      fd = openSync(options.filePath, 'r');
    } catch {
      return;
    }
    try {
      const length = size - offset;
      const buffer = Buffer.allocUnsafe(length);
      const read = readSync(fd, buffer, 0, length, offset);
      offset += read;
      // Concat copies the read bytes, so carrying a partial trailing line into the next poll
      // (and decoding only whole lines below) keeps a mid-codepoint split intact.
      pending = Buffer.concat([pending, buffer.subarray(0, read)]);
    } finally {
      closeSync(fd);
    }

    let newline = pending.indexOf(NEWLINE);
    while (newline !== -1) {
      const line = pending.subarray(0, newline).toString('utf8');
      pending = pending.subarray(newline + 1);
      if (line.length > 0) options.onEntry(line);
      newline = pending.indexOf(NEWLINE);
    }
  }

  function poll(): void {
    if (stopped) return;
    try {
      drainNewBytes();
    } catch (err) {
      // Never let a tail read crash the runner; capture is best-effort.
      logger().warn({err, filePath: options.filePath}, 'Agent session tail failed');
    }
  }

  const timer = setInterval(poll, intervalMs);
  // A pending poll must not keep the runner process alive on its own.
  timer.unref();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Final synchronous read so every entry written before stop is forwarded ahead of the
      // caller closing the log stream.
      try {
        drainNewBytes();
      } catch (err) {
        logger().warn({err, filePath: options.filePath}, 'Agent session tail failed');
      }
    },
  };
}
