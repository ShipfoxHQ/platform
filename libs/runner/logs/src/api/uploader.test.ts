import type {LogAppendFn, LogAppendOutcome} from '@shipfox/runner-protocol';
import {LogUploader, type SpoolReader} from '#api/uploader.js';

class FakeSpool implements SpoolReader {
  private buf: Buffer = Buffer.alloc(0);

  constructor(initial: Buffer = Buffer.alloc(0)) {
    this.buf = initial;
  }

  get length(): number {
    return this.buf.length;
  }

  append(bytes: Buffer): void {
    this.buf = Buffer.concat([this.buf, bytes]);
  }

  read(offset: number, maxBytes: number): Buffer {
    return this.buf.subarray(offset, offset + maxBytes);
  }
}

// An offset-CAS server: extends at offset == committed, acks already-applied
// when offset < committed, rejects a gap when offset > committed.
function casServer(opts: {startCommitted?: number; capAt?: number} = {}) {
  let committed = opts.startCommitted ?? 0;
  const calls: Array<{offset: number; length: number}> = [];
  const append: LogAppendFn = ({offset, body}) => {
    calls.push({offset, length: body.length});
    if (offset > committed)
      return Promise.resolve({status: 'conflict', committedLength: committed});
    if (offset === committed) committed += body.length;
    const capped = opts.capAt !== undefined && committed >= opts.capAt;
    return Promise.resolve({status: 'committed', committedLength: committed, capped});
  };
  return {append, calls, committed: () => committed};
}

function scriptedServer(outcomes: LogAppendOutcome[]) {
  const calls: Array<{offset: number; length: number}> = [];
  const queue = [...outcomes];
  const append: LogAppendFn = ({offset, body}) => {
    calls.push({offset, length: body.length});
    const next: LogAppendOutcome = queue.shift() ?? {status: 'stopped'};
    return Promise.resolve(next);
  };
  return {append, calls};
}

// Never resolves on its own; rejects only when its append signal aborts (simulates an
// API hang). Lets tests assert drain/stop cut the in-flight append rather than waiting.
function hangingServer() {
  let calls = 0;
  let aborts = 0;
  const append: LogAppendFn = ({signal}) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => {
          aborts += 1;
          reject(new Error('aborted'));
        },
        {once: true},
      );
    });
  };
  return {append, callCount: () => calls, abortedCount: () => aborts};
}

const OPTS = {intervalMs: 1000, flushBytes: 1024};

describe('LogUploader.flush', () => {
  it('probes then ships spooled bytes, advancing acked to committed', async () => {
    const spool = new FakeSpool(Buffer.from('abcdef'));
    const server = casServer();
    const uploader = new LogUploader(spool, server.append, OPTS);

    await uploader.flush();

    expect(uploader.ackedOffset).toBe(6);
    expect(server.committed()).toBe(6);
    // First call is the zero-length probe at offset 0.
    expect(server.calls[0]).toEqual({offset: 0, length: 0});
  });

  it('resumes over an existing spool without re-sending committed bytes (dedup)', async () => {
    // Server already holds the first 5 bytes; the spool on disk has all 8.
    const spool = new FakeSpool(Buffer.from('12345678'));
    const server = casServer({startCommitted: 5});
    const uploader = new LogUploader(spool, server.append, OPTS);

    await uploader.flush();

    expect(uploader.ackedOffset).toBe(8);
    expect(server.committed()).toBe(8);
    // Only the suffix [5..8) is sent as data; nothing re-sends [0..5).
    const dataCalls = server.calls.filter((c) => c.length > 0);
    expect(dataCalls).toEqual([{offset: 5, length: 3}]);
  });

  it('rewinds to the server offset on a conflict, then resends from there', async () => {
    const spool = new FakeSpool(Buffer.from('abcde'));
    const server = scriptedServer([
      {status: 'committed', committedLength: 0, capped: false}, // probe
      {status: 'conflict', committedLength: 2}, // first data send → rewind to 2
      {status: 'committed', committedLength: 5, capped: false}, // resend from 2
    ]);
    const uploader = new LogUploader(spool, server.append, OPTS);

    await uploader.flush();

    expect(uploader.ackedOffset).toBe(5);
    expect(server.calls.map((c) => c.offset)).toEqual([0, 0, 2]);
  });

  it('stops uploading once the server reports capped', async () => {
    const spool = new FakeSpool(Buffer.from('0123456789'));
    const server = casServer({capAt: 4});
    const uploader = new LogUploader(spool, server.append, {intervalMs: 1000, flushBytes: 4});

    await uploader.flush();
    const ackedAfterCap = uploader.ackedOffset;
    await uploader.flush();

    expect(uploader.isCapped()).toBe(true);
    expect(uploader.ackedOffset).toBe(ackedAfterCap);
    // No further appends after the cap (probe + one data batch only).
    expect(server.calls.length).toBe(2);
  });

  it('stops on a terminal endpoint outcome and sends nothing more', async () => {
    const spool = new FakeSpool(Buffer.from('abc'));
    const server = scriptedServer([{status: 'stopped'}]);
    const uploader = new LogUploader(spool, server.append, OPTS);

    await uploader.flush();
    await uploader.flush();

    expect(uploader.isStopped()).toBe(true);
    expect(server.calls.length).toBe(1);
  });

  it('stops instead of looping when a non-empty body makes no progress', async () => {
    const spool = new FakeSpool(Buffer.from('abcdef'));
    // A stuck server that accepts but never advances its committed length.
    let calls = 0;
    const append: LogAppendFn = () => {
      calls += 1;
      return Promise.resolve({status: 'committed', committedLength: 0, capped: false});
    };
    const uploader = new LogUploader(spool, append, OPTS);

    await uploader.flush();

    expect(uploader.isStopped()).toBe(true);
    // Probe, then one data send that made no progress, then stop. It is not an endless re-send.
    expect(calls).toBe(2);
  });

  it('stops when the server committed offset is ahead of the local spool', async () => {
    const spool = new FakeSpool(Buffer.from('abc')); // 3 bytes on disk
    // The probe reports the server already holds more than this runner has spooled.
    const server = scriptedServer([{status: 'committed', committedLength: 10, capped: false}]);
    const uploader = new LogUploader(spool, server.append, OPTS);

    await uploader.flush();

    expect(uploader.isStopped()).toBe(true);
    expect(uploader.ackedOffset).toBe(0); // never adopted the foreign offset
    expect(server.calls).toHaveLength(1); // only the probe; no data shipped onto the prefix
  });

  it('is single-flight: concurrent flush() calls share one run and probe once', async () => {
    const spool = new FakeSpool(Buffer.from('abcdef'));
    const server = casServer();
    const uploader = new LogUploader(spool, server.append, OPTS);

    const first = uploader.flush();
    const second = uploader.flush();
    expect(first).toBe(second);

    await first;

    const probes = server.calls.filter((c) => c.length === 0);
    expect(probes).toHaveLength(1);
    expect(uploader.ackedOffset).toBe(6);
  });
});

describe('LogUploader.notify', () => {
  it('flushes only once the unacked backlog reaches flushBytes', async () => {
    const spool = new FakeSpool();
    const server = casServer();
    const uploader = new LogUploader(spool, server.append, {intervalMs: 1000, flushBytes: 10});

    spool.append(Buffer.from('123')); // backlog 3 < 10
    uploader.notify();
    expect(server.calls).toHaveLength(0);

    spool.append(Buffer.from('4567890')); // backlog 10 >= 10
    uploader.notify();
    await uploader.flush(); // join the notify-triggered flush

    expect(uploader.ackedOffset).toBe(10);
    uploader.stop();
  });
});

describe('LogUploader.stop', () => {
  it('aborts the in-flight append and makes later flush/notify no-ops', async () => {
    const spool = new FakeSpool(Buffer.from('a'.repeat(100)));
    const server = hangingServer();
    const uploader = new LogUploader(spool, server.append, {intervalMs: 1000, flushBytes: 1024});

    const flushing = uploader.flush(); // probe hangs, inflight controller is set
    await Promise.resolve();
    uploader.stop();
    await flushing;

    expect(uploader.isStopped()).toBe(true);
    expect(server.abortedCount()).toBe(1);

    const callsBefore = server.callCount();
    uploader.notify();
    await uploader.flush();
    expect(server.callCount()).toBe(callsBefore);
  });
});

describe('LogUploader.drain', () => {
  it('ships everything spooled within the timeout', async () => {
    const spool = new FakeSpool(Buffer.from('a'.repeat(5000)));
    const server = casServer();
    const uploader = new LogUploader(spool, server.append, {intervalMs: 1, flushBytes: 1024});

    await uploader.drain({timeoutMs: 1000});

    expect(uploader.ackedOffset).toBe(5000);
    expect(server.committed()).toBe(5000);
  });

  it('returns within the deadline and aborts the in-flight append when the API hangs', async () => {
    const spool = new FakeSpool(Buffer.from('a'.repeat(100)));
    const server = hangingServer();
    const uploader = new LogUploader(spool, server.append, {intervalMs: 1000, flushBytes: 1024});

    const start = Date.now();
    await uploader.drain({timeoutMs: 20});
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(900); // did not wait for a transport timeout
    expect(uploader.ackedOffset).toBe(0);
    expect(server.abortedCount()).toBe(1); // the stuck append was cut
    uploader.stop();
  });

  it('returns immediately when the abort signal is already aborted', async () => {
    const spool = new FakeSpool(Buffer.from('a'.repeat(100)));
    const server = hangingServer();
    const uploader = new LogUploader(spool, server.append, {intervalMs: 1000, flushBytes: 1024});
    const ac = new AbortController();
    ac.abort();

    await uploader.drain({signal: ac.signal, timeoutMs: 1000});

    expect(uploader.ackedOffset).toBe(0);
    expect(server.callCount()).toBe(0); // never even started a flush
    uploader.stop();
  });

  it('backs off and retries after a flush that does not catch up', async () => {
    const spool = new FakeSpool(Buffer.from('abcdef'));
    let committed = 0;
    let failedOnce = false;
    const append: LogAppendFn = ({offset, body}) => {
      if (offset > committed)
        return Promise.resolve({status: 'conflict', committedLength: committed});
      if (body.length > 0 && !failedOnce) {
        failedOnce = true;
        return Promise.reject(new Error('transient'));
      }
      if (offset === committed) committed += body.length;
      return Promise.resolve({status: 'committed', committedLength: committed, capped: false});
    };
    const uploader = new LogUploader(spool, append, {intervalMs: 1, flushBytes: 1024});

    await uploader.drain({timeoutMs: 1000});
    uploader.stop();

    expect(uploader.ackedOffset).toBe(6);
    expect(committed).toBe(6);
  });
});
