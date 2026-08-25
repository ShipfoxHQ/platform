import {Buffer} from 'node:buffer';
import {Readable} from 'node:stream';
import {createGzip} from 'node:zlib';
import {deleteObject, headObject, putCompactedObject} from './object-storage.js';

function testKey(): string {
  return `logs/test/${crypto.randomUUID()}`;
}

async function objectExists(key: string): Promise<boolean> {
  return (await headObject(key)) !== null;
}

describe('putCompactedObject', () => {
  it('rejects without writing when the signal is already aborted', async () => {
    const key = testKey();

    const upload = putCompactedObject({
      key,
      body: Readable.from([Buffer.from('x')]).pipe(createGzip()),
      metadata: {},
      signal: AbortSignal.abort(),
    });

    await expect(upload).rejects.toThrow('aborted before it started');
    expect(await objectExists(key)).toBe(false);
  });

  it('aborts the in-flight upload and rejects when the signal fires mid-stream', async () => {
    const key = testKey();
    const controller = new AbortController();
    // Aborts as soon as the upload starts pulling, and never ends, so the upload is genuinely
    // in flight (no complete part, no CompleteMultipartUpload) when the abort lands.
    const body = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        controller.abort();
      },
    });

    const upload = putCompactedObject({
      key,
      body: body.pipe(createGzip()),
      metadata: {},
      signal: controller.signal,
    });

    await expect(upload).rejects.toThrow();
    expect(await objectExists(key)).toBe(false);
  });
});

describe('deleteObject', () => {
  it('resolves for a key that does not exist (idempotent)', async () => {
    await expect(deleteObject(testKey())).resolves.toBeUndefined();
  });
});
