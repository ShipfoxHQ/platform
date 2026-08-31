import {appendFileSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startSessionForwarder} from '#core/session-forwarder.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('startSessionForwarder', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipfox-session-forwarder-'));
    file = join(dir, 'session.jsonl');
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  it('emits nothing for a file that never appears and stops quietly', () => {
    const lines: string[] = [];
    const forwarder = startSessionForwarder({filePath: file, onEntry: (l) => lines.push(l)});

    expect(() => forwarder.stop()).not.toThrow();
    expect(lines).toEqual([]);
  });

  it('emits a deferred bulk first write as N ordered lines', () => {
    const lines: string[] = [];
    const forwarder = startSessionForwarder({filePath: file, onEntry: (l) => lines.push(l)});

    // pi defers the first write, then writes the header plus buffered entries at once.
    writeFileSync(file, '{"type":"session"}\n{"type":"message","id":"a"}\n{"type":"label"}\n');
    forwarder.stop();

    expect(lines).toEqual([
      '{"type":"session"}',
      '{"type":"message","id":"a"}',
      '{"type":"label"}',
    ]);
  });

  it('skips pre-existing entries when starting at the end of a forked session', () => {
    writeFileSync(file, '{"type":"session"}\n{"type":"message","id":"parent"}\n');
    const lines: string[] = [];
    const forwarder = startSessionForwarder({
      filePath: file,
      onEntry: (l) => lines.push(l),
      startAtEnd: true,
    });

    appendFileSync(file, '{"type":"message","id":"child"}\n');
    forwarder.stop();

    expect(lines).toEqual(['{"type":"message","id":"child"}']);
  });

  it('forwards entries incrementally and in order as they are appended', async () => {
    const lines: string[] = [];
    writeFileSync(file, '');
    const forwarder = startSessionForwarder({
      filePath: file,
      onEntry: (l) => lines.push(l),
      intervalMs: 5,
    });

    appendFileSync(file, '{"a":1}\n');
    await vi.waitFor(() => expect(lines).toEqual(['{"a":1}']));
    appendFileSync(file, '{"b":2}\n');
    await vi.waitFor(() => expect(lines).toEqual(['{"a":1}', '{"b":2}']));

    forwarder.stop();
  });

  it('holds a partial line until its newline arrives', async () => {
    const lines: string[] = [];
    const lineWithoutTrailingNewline = '{"partial":1}';
    const forwarder = startSessionForwarder({
      filePath: file,
      onEntry: (l) => lines.push(l),
      intervalMs: 5,
    });

    appendFileSync(file, lineWithoutTrailingNewline);
    await delay(30);
    expect(lines).toEqual([]);

    appendFileSync(file, '\n');
    await vi.waitFor(() => expect(lines).toEqual(['{"partial":1}']));

    forwarder.stop();
  });

  it('reassembles a multi-byte character split across two reads', async () => {
    const lines: string[] = [];
    const entry = '{"emoji":"😀 héllo"}';
    const bytes = Buffer.from(`${entry}\n`, 'utf8');
    const splitInsideCodepoint = Buffer.byteLength('{"emoji":"', 'utf8') + 1;
    writeFileSync(file, '');
    const forwarder = startSessionForwarder({
      filePath: file,
      onEntry: (l) => lines.push(l),
      intervalMs: 5,
    });

    appendFileSync(file, bytes.subarray(0, splitInsideCodepoint));
    await delay(20);
    appendFileSync(file, bytes.subarray(splitInsideCodepoint));

    await vi.waitFor(() => expect(lines).toEqual([entry]));
    forwarder.stop();
  });

  it('re-reads from the start when the file is truncated to a shorter length', async () => {
    const lines: string[] = [];
    writeFileSync(file, '{"first":1}\n'); // 12 bytes
    const forwarder = startSessionForwarder({
      filePath: file,
      onEntry: (l) => lines.push(l),
      intervalMs: 5,
    });
    await vi.waitFor(() => expect(lines).toEqual(['{"first":1}']));

    // Replace with strictly shorter content: the offset (12) now points past the new end,
    // so the tailer must reset and forward the new file instead of silently skipping it.
    writeFileSync(file, '{"b":2}\n'); // 8 bytes
    await vi.waitFor(() => expect(lines).toEqual(['{"first":1}', '{"b":2}']));

    forwarder.stop();
  });

  it('does a final read on stop so trailing entries are forwarded', () => {
    const lines: string[] = [];
    const intervalTooLongForTest = 1_000_000;
    const forwarder = startSessionForwarder({
      filePath: file,
      onEntry: (l) => lines.push(l),
      intervalMs: intervalTooLongForTest,
    });

    writeFileSync(file, '{"x":1}\n{"y":2}\n');
    forwarder.stop();

    expect(lines).toEqual(['{"x":1}', '{"y":2}']);
  });

  it('stops quietly when the file is deleted mid-tail', async () => {
    const lines: string[] = [];
    writeFileSync(file, '{"a":1}\n');
    const forwarder = startSessionForwarder({
      filePath: file,
      onEntry: (l) => lines.push(l),
      intervalMs: 5,
    });

    await vi.waitFor(() => expect(lines).toEqual(['{"a":1}']));
    rmSync(file);
    await delay(20);

    expect(() => forwarder.stop()).not.toThrow();
    expect(lines).toEqual(['{"a":1}']);
  });
});
