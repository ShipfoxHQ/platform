import {EventEmitter} from 'node:events';
import {
  closePiSvgRasterizer,
  createPiSvgRasterizer,
  PI_SVG_RASTERIZATION_LIMITS,
  rasterizeSvg,
} from './pi-image-rasterizer.js';
import {inspectSvgPolicy} from './pi-svg-policy.js';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

afterEach(async () => {
  await closePiSvgRasterizer();
});

describe('inspectSvgPolicy', () => {
  it.each([
    ['DOCTYPE', '<!DOCTYPE svg>'],
    ['ENTITY', '<!ENTITY badge "value">'],
    ['script', '<script>alert(1)</script>'],
    ['namespaced script', '<svg:script>alert(1)</svg:script>'],
    ['foreignObject', '<foreignObject></foreignObject>'],
  ])('rejects %s tokens', (_name, token) => {
    expect(inspectSvgPolicy(new TextEncoder().encode(token))).toBe('unsafe_svg');
  });

  it.each([
    '<image href="https://example.test/image.png" />',
    '<image href="data:image/png;base64,AAAA" />',
    '<rect style="fill: url(https://example.test/fill)" />',
  ])('rejects resource references without resolving them', (reference) => {
    expect(inspectSvgPolicy(new TextEncoder().encode(reference))).toBe('external_resource');
  });

  it('allows same-document fragment references', () => {
    expect(
      inspectSvgPolicy(
        new TextEncoder().encode('<use href="#badge" /><rect style="fill:url(#fill)" />'),
      ),
    ).toBeUndefined();
  });
});

describe('rasterizeSvg', () => {
  it('converts a safe SVG to a bounded PNG and exposes safe timing data', async () => {
    const result = await rasterizeSvg({
      base64: encodedSvg('<rect width="80" height="40" fill="red" />'),
    });

    expect(result.outcome).toBe('converted');
    if (result.outcome !== 'converted') return;
    expect(Array.from(result.png.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(result.width).toBe(80);
    expect(result.height).toBe(40);
    expect(result.inputBytes).toBeGreaterThan(0);
    expect(result.outputBytes).toBe(result.png.byteLength);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs);
  });

  it('scales dimensions and pixel count without enlarging the source', async () => {
    const result = await rasterizeSvg({
      base64: encodedSvg('<rect width="3000" height="3000" fill="red" />', 3000, 3000),
    });

    expect(result.outcome).toBe('converted');
    if (result.outcome !== 'converted') return;
    expect(result.width).toBeLessThanOrEqual(PI_SVG_RASTERIZATION_LIMITS.maxOutputEdge);
    expect(result.height).toBeLessThanOrEqual(PI_SVG_RASTERIZATION_LIMITS.maxOutputEdge);
    expect(result.width * result.height).toBeLessThanOrEqual(
      PI_SVG_RASTERIZATION_LIMITS.maxOutputPixels,
    );
  });

  it.each([
    ['', 'invalid_base64'],
    ['not base64', 'invalid_base64'],
    ['AAA', 'invalid_base64'],
    ['AAAA\n', 'invalid_base64'],
  ] as const)('rejects malformed base64 (%s)', async (base64, reason) => {
    await expect(rasterizeSvg({base64})).resolves.toMatchObject({outcome: 'omitted', reason});
  });

  it('rejects decoded SVG input above one MiB before worker dispatch', async () => {
    const base64 = Buffer.alloc(PI_SVG_RASTERIZATION_LIMITS.maxInputBytes + 1, 65).toString(
      'base64',
    );

    await expect(rasterizeSvg({base64})).resolves.toMatchObject({
      outcome: 'omitted',
      reason: 'input_too_large',
    });
  });

  it.each([
    ['DOCTYPE', '<!DOCTYPE svg>'],
    ['ENTITY', '<!ENTITY badge "value">'],
    ['script', '<script>alert(1)</script>'],
    ['namespaced script', '<svg:script>alert(1)</svg:script>'],
    ['foreignObject', '<foreignObject></foreignObject>'],
  ])('omits SVG containing %s', async (_name, token) => {
    await expect(rasterizeSvg({base64: encodedSvg(token)})).resolves.toMatchObject({
      outcome: 'omitted',
      reason: 'unsafe_svg',
    });
  });

  it('omits external resources before any worker can resolve them', async () => {
    await expect(
      rasterizeSvg({
        base64: encodedSvg(
          '<image href="https://example.test/badge.png" width="10" height="10" />',
        ),
      }),
    ).resolves.toMatchObject({outcome: 'omitted', reason: 'external_resource'});
  });

  it('keeps unknown-family text and Latin-2 glyphs visible with fixed fonts', async () => {
    const withoutText = await rasterizeSvg({
      base64: encodedSvg('<rect width="180" height="60" fill="white" />', 180, 60),
    });
    const withText = await rasterizeSvg({
      base64: encodedSvg(
        '<rect width="180" height="60" fill="white" /><text x="4" y="42" font-family="PiUnknownFamily" font-size="38">Ł</text>',
        180,
        60,
      ),
    });

    expect(withoutText.outcome).toBe('converted');
    expect(withText.outcome).toBe('converted');
    if (withoutText.outcome !== 'converted' || withText.outcome !== 'converted') return;
    expect(Buffer.from(withText.png).equals(Buffer.from(withoutText.png))).toBe(false);
  });
});

describe('worker lifecycle', () => {
  it('terminates and replaces a timed-out worker before accepting another render', async () => {
    const workers: FakeRenderWorker[] = [];
    const rasterizer = createPiSvgRasterizer({
      workerFactory: (() => {
        const worker = new FakeRenderWorker(workers.length === 0 ? () => undefined : renderPng);
        workers.push(worker);
        return worker;
      }) as never,
    });

    const first = await rasterizer.rasterize({base64: encodedSvg('<rect />')});
    expect(first).toMatchObject({outcome: 'omitted', reason: 'render_timeout'});
    expect(workers[0]?.terminated).toBe(true);

    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const second = await rasterizer.rasterize({base64: encodedSvg('<rect />')});
    expect(second.outcome).toBe('converted');
    await rasterizer.close();
  }, 10_000);

  it('replaces a worker after a malformed protocol response', async () => {
    const workers: FakeRenderWorker[] = [];
    const rasterizer = createPiSvgRasterizer({
      workerFactory: (() => {
        const worker = new FakeRenderWorker(
          workers.length === 0
            ? (message, current) =>
                current.emit('message', {type: 'unexpected', requestId: message.requestId})
            : renderPng,
        );
        workers.push(worker);
        return worker;
      }) as never,
    });

    const first = await rasterizer.rasterize({base64: encodedSvg('<rect />')});
    expect(first).toMatchObject({outcome: 'omitted', reason: 'render_error'});
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await expect(rasterizer.rasterize({base64: encodedSvg('<rect />')})).resolves.toMatchObject({
      outcome: 'converted',
    });
    await rasterizer.close();
  });

  it('replaces an idle worker after an unexpected exit', async () => {
    const workers: FakeRenderWorker[] = [];
    const rasterizer = createPiSvgRasterizer({
      workerFactory: (() => {
        const workerIndex = workers.length;
        let behavior: ConstructorParameters<typeof FakeRenderWorker>[0];
        if (workerIndex === 0) {
          behavior = (message, current) => setTimeout(() => renderPng(message, current), 0);
        } else if (workerIndex === 1) {
          behavior = () => undefined;
        } else {
          behavior = renderPng;
        }
        const worker = new FakeRenderWorker(behavior);
        workers.push(worker);
        return worker;
      }) as never,
    });

    const first = rasterizer.rasterize({base64: encodedSvg('<rect />')});
    const hanging = rasterizer.rasterize({base64: encodedSvg('<rect />')});
    await expect(first).resolves.toMatchObject({outcome: 'converted'});
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[0]?.emit('exit', 1);
    await vi.waitFor(() => expect(workers).toHaveLength(3));
    await expect(rasterizer.rasterize({base64: encodedSvg('<rect />')})).resolves.toMatchObject({
      outcome: 'converted',
    });
    await rasterizer.close();
    await hanging;
  });

  it('rejects malformed PNG bytes in the parent and replaces the worker', async () => {
    const workers: FakeRenderWorker[] = [];
    const rasterizer = createPiSvgRasterizer({
      workerFactory: (() => {
        const worker = new FakeRenderWorker(
          workers.length === 0
            ? (message, current) =>
                current.emit('message', {
                  type: 'rendered',
                  requestId: message.requestId,
                  png: arrayBufferOf(Uint8Array.from([1, 2, 3])),
                })
            : renderPng,
        );
        workers.push(worker);
        return worker;
      }) as never,
    });

    await expect(rasterizer.rasterize({base64: encodedSvg('<rect />')})).resolves.toMatchObject({
      outcome: 'omitted',
      reason: 'render_error',
    });
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await rasterizer.close();
  });

  it('bounds queued work at 32 renders beyond the two active workers', async () => {
    const rasterizer = createPiSvgRasterizer({
      workerFactory: (() => new FakeRenderWorker(() => undefined)) as never,
    });
    const renders = Array.from({length: 35}, () =>
      rasterizer.rasterize({base64: encodedSvg('<rect />'), deadlineMs: 1}),
    );

    const results = await Promise.all(renders);
    expect(
      results.filter(
        (result) => result.outcome === 'omitted' && result.reason === 'pool_saturated',
      ),
    ).toHaveLength(1);
    await rasterizer.close();
  });
});

class FakeRenderWorker extends EventEmitter {
  terminated = false;

  constructor(
    private readonly behavior: (message: {requestId: number}, worker: FakeRenderWorker) => void,
  ) {
    super();
  }

  postMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return;
    const requestId = (message as {requestId?: unknown}).requestId;
    if (typeof requestId !== 'number') return;
    this.behavior({requestId}, this);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }

  unref(): void {
    return;
  }
}

function renderPng(message: {requestId: number}, worker: FakeRenderWorker): void {
  worker.emit('message', {
    type: 'rendered',
    requestId: message.requestId,
    png: arrayBufferOf(minimalPng()),
  });
}

function minimalPng(width = 1, height = 1): Uint8Array {
  const png = new Uint8Array(45);
  png.set(PNG_SIGNATURE, 0);
  const view = new DataView(png.buffer);
  view.setUint32(8, 13);
  png.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  png[24] = 8;
  png[25] = 6;
  png[26] = 0;
  png[27] = 0;
  png[28] = 0;
  view.setUint32(29, 0);
  png.set([73, 69, 78, 68], 37);
  return png;
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function encodedSvg(body: string, width = 80, height = 40): string {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`,
  ).toString('base64');
}
