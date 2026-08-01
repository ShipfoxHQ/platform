import {redactSecrets} from '@shipfox/redact';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import {config} from '#config.js';
import {type FramedOutput, StreamFramer} from '#core/framing.js';
import type {LogStreamLifecycle} from '#core/lifecycle.js';
import {createRecordSink} from '#core/record-sink.js';
import {buildSecretVariants} from '#core/secrets.js';

export interface SessionLogStreamOptions {
  logsDir: string;
  stepId: string;
  attempt: number;
  append: LogAppendFn;
  /**
   * Secrets masked out of each entry before it reaches the spool, each replaced (with all its
   * base64/base64url/url/hex forms) by `***`. Empty disables masking.
   */
  secrets?: string[];
  /**
   * Upload window and per-entry drop threshold. An entry whose encoded record exceeds it is
   * dropped with a gap. Defaults to `SHIPFOX_AGENT_SESSION_FLUSH_BYTES`.
   */
  flushBytes?: number;
  spoolMaxBytes?: number;
  flushIntervalMs?: number;
  now?: () => number;
}

export interface SessionLogStream extends LogStreamLifecycle {
  writeEntry(line: string): void;
  /** Registers additional secrets for subsequent agent session entries. */
  addSecrets(secrets: string[]): void;
  /** Replaces the bounded rotating secret slot for renewed lease tokens. */
  setRotatingSecrets(secrets: string[]): void;
}

/**
 * Forwards verbatim agent session entries onto the step attempt's log stream as opaque
 * `agent_session` records over the shared `RecordSink`. One entry rides one record (never
 * split: that would break the entry's JSON); masking applies whole-line, so no streaming
 * lookbehind is needed. An over-window entry is dropped with a gap rather than forwarded.
 */
export function createSessionLogStream(options: SessionLogStreamOptions): SessionLogStream {
  const now = options.now ?? Date.now;
  const flushBytes = options.flushBytes ?? config.SHIPFOX_AGENT_SESSION_FLUSH_BYTES;
  const framer = new StreamFramer(now);
  const baseSecrets = [...(options.secrets ?? [])];
  let addedSecrets: string[] = [];
  let rotatingSecrets: string[] = [];
  let variants = buildSecretVariants(baseSecrets);

  const sink = createRecordSink({
    logsDir: options.logsDir,
    stepId: options.stepId,
    attempt: options.attempt,
    append: options.append,
    now,
    flushBytes,
    ...(options.spoolMaxBytes !== undefined ? {spoolMaxBytes: options.spoolMaxBytes} : {}),
    ...(options.flushIntervalMs !== undefined ? {flushIntervalMs: options.flushIntervalMs} : {}),
  });

  return {
    writeEntry(line) {
      if (line.length === 0) return;
      if (sink.isClosed() || sink.isFailed() || sink.isCapped() || sink.isStopped()) return;

      let framed: FramedOutput;
      try {
        const masked = variants.length > 0 ? redactSecrets(line, variants) : line;
        framed = framer.frameAgentSession(masked);
      } catch (err) {
        // Masking/framing is pure, but guard the boundary so a surprise never escapes into
        // the tailer callback and crashes the runner.
        sink.fail(err);
        return;
      }

      // One entry rides one record and is never split. A record larger than the flush window
      // could not be read back whole or accepted by the server, so drop it and account a gap
      // of the entry's bytes instead.
      if (framed.bytes.length > flushBytes) {
        sink.dropPayload(framed.payloadBytes);
        return;
      }

      sink.spool(framed);
      sink.notify();
    },

    addSecrets(secrets) {
      if (secrets.length === 0) return;
      addedSecrets = [
        ...new Set([...addedSecrets, ...secrets.filter((secret) => secret.length > 0)]),
      ];
      refreshSecrets();
    },

    setRotatingSecrets(secrets) {
      rotatingSecrets = [...new Set(secrets.filter((secret) => secret.length > 0))];
      refreshSecrets();
    },

    close() {
      return Promise.resolve(sink.closeWithEnd());
    },

    async drain(opts = {}) {
      return await sink.drain(opts);
    },

    dispose() {
      sink.dispose();
    },
  };

  function refreshSecrets(): void {
    variants = buildSecretVariants([...baseSecrets, ...addedSecrets, ...rotatingSecrets]);
  }
}
