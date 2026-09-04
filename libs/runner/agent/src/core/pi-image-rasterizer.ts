import {access, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {Worker, type WorkerOptions} from 'node:worker_threads';
import {validatePngOutput} from './pi-png.js';
import {inspectSvgPolicy} from './pi-svg-policy.js';
import {
  PI_SVG_FONT_ASSET_FILENAMES,
  PI_SVG_LICENSE_ASSET_FILENAME,
  PI_SVG_RASTERIZATION_LIMITS,
} from './pi-svg-render-config.js';

export {PI_SVG_RASTERIZATION_LIMITS} from './pi-svg-render-config.js';

const MAX_ENCODED_BASE64_LENGTH = Math.ceil(PI_SVG_RASTERIZATION_LIMITS.maxInputBytes / 3) * 4;
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PRODUCTION_WORKER_URL = new URL('./pi-svg-render-worker.js', import.meta.url);
const SOURCE_WORKER_URL = new URL('./pi-svg-render-worker.ts', import.meta.url);
const FONT_ASSET_URLS = PI_SVG_FONT_ASSET_FILENAMES.map(
  (filename) => new URL(`../assets/pi-svg/${filename}`, import.meta.url),
);
const LICENSE_ASSET_URL = new URL(
  `../assets/pi-svg/${PI_SVG_LICENSE_ASSET_FILENAME}`,
  import.meta.url,
);
const require = createRequire(import.meta.url);

export type SvgRasterizationReason =
  | 'invalid_base64'
  | 'input_too_large'
  | 'unsafe_svg'
  | 'external_resource'
  | 'render_timeout'
  | 'render_error'
  | 'output_too_large'
  | 'pool_saturated'
  | 'result_budget_exhausted'
  | 'rasterizer_unavailable';

export type SvgRasterizationResult =
  | {
      outcome: 'converted';
      png: Uint8Array;
      width: number;
      height: number;
      inputBytes: number;
      outputBytes: number;
      durationMs: number;
    }
  | {
      outcome: 'omitted';
      reason: SvgRasterizationReason;
      inputBytes?: number;
      outputBytes?: number;
      durationMs: number;
    };

type WorkerFailureReason =
  | 'external_resource'
  | 'output_too_large'
  | 'rasterizer_unavailable'
  | 'render_error'
  | 'unsafe_svg'
  | 'protocol_failure';
type WorkerStartupResponse = {type: 'ready'} | {type: 'initialization_failed'};
type WorkerRenderResponse =
  | {type: 'rendered'; requestId: number; png: ArrayBuffer}
  | {type: 'failed'; requestId: number; reason: WorkerFailureReason};
type WorkerMessage = {type: 'render'; requestId: number; svg: ArrayBuffer};
type RenderWorker = Pick<Worker, 'on' | 'postMessage' | 'removeAllListeners' | 'terminate'> & {
  unref?: () => void;
};
type WorkerFactory = (url: URL) => RenderWorker;

type PoolResult =
  | {ok: true; png: Uint8Array; width: number; height: number}
  | {ok: false; reason: SvgRasterizationReason};

type RenderTask = {
  id: number;
  bytes: Uint8Array;
  deadlineAt: number;
  resolve: (result: PoolResult) => void;
  queueTimer: ReturnType<typeof setTimeout> | undefined;
};

type WorkerSlot = {
  worker: RenderWorker | undefined;
  ready: boolean;
  task: RenderTask | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  replacing: boolean;
  termination: Promise<void> | undefined;
};

export interface PiSvgRasterizer {
  rasterize(params: {base64: string; deadlineMs?: number}): Promise<SvgRasterizationResult>;
  close(): Promise<void>;
}

/** Creates an isolated pool; the default exported rasterize function uses one process-wide pool. */
export function createPiSvgRasterizer(
  options: {workerFactory?: WorkerFactory; workerUrl?: URL} = {},
): PiSvgRasterizer {
  return new BoundedPiSvgRasterizer(options);
}

/** Rasterizes one raw MCP base64 SVG through the process-wide bounded worker pool. */
export function rasterizeSvg(params: {
  base64: string;
  deadlineMs?: number;
}): Promise<SvgRasterizationResult> {
  return getProcessRasterizer().rasterize(params);
}

/** Closes the process-wide pool; intended for orderly runner shutdown and isolated tests. */
export async function closePiSvgRasterizer(): Promise<void> {
  const rasterizer = processRasterizer;
  processRasterizer = undefined;
  if (rasterizer !== undefined) await rasterizer.close();
}

/** Verifies every production asset and performs a real worker render from the built closure. */
export async function assertPiImageRasterizerAvailable(): Promise<void> {
  await assertRuntimeAssetsAvailable();
  const rasterizer = createPiSvgRasterizer({workerUrl: PRODUCTION_WORKER_URL});
  try {
    const withoutText = await rasterizer.rasterize({base64: smokeSvgBase64(false)});
    assertSmokeRenderConverted('without text', withoutText);
    const withText = await rasterizer.rasterize({base64: smokeSvgBase64(true)});
    assertSmokeRenderConverted('with text', withText);
    if (Buffer.from(withoutText.png).equals(Buffer.from(withText.png))) {
      throw new Error('Pi SVG rasterizer smoke render did not retain text');
    }
  } finally {
    await rasterizer.close();
  }
}

let processRasterizer: PiSvgRasterizer | undefined;

function getProcessRasterizer(): PiSvgRasterizer {
  if (processRasterizer === undefined) processRasterizer = createPiSvgRasterizer();
  return processRasterizer;
}

class BoundedPiSvgRasterizer implements PiSvgRasterizer {
  private readonly pool: SvgRenderPool;
  private closed = false;

  constructor(options: {workerFactory?: WorkerFactory; workerUrl?: URL}) {
    this.pool = new SvgRenderPool({
      workerFactory: options.workerFactory ?? defaultWorkerFactory,
      workerUrl: options.workerUrl ?? defaultWorkerUrl(),
    });
  }

  async rasterize(params: {base64: string; deadlineMs?: number}): Promise<SvgRasterizationResult> {
    const startedAt = performance.now();
    if (this.closed) return omitted(startedAt, 'rasterizer_unavailable');

    const decoded = decodeSvgBase64(params.base64);
    if (!decoded.ok) return omitted(startedAt, decoded.reason, decoded.inputBytes);

    const policyRejection = inspectSvgPolicy(decoded.bytes);
    if (policyRejection !== undefined) {
      return omitted(startedAt, policyRejection, decoded.bytes.byteLength);
    }

    try {
      const result = await this.pool.render(decoded.bytes, params.deadlineMs);
      if (!result.ok) {
        return omitted(startedAt, result.reason, decoded.bytes.byteLength);
      }
      return {
        outcome: 'converted',
        png: result.png,
        width: result.width,
        height: result.height,
        inputBytes: decoded.bytes.byteLength,
        outputBytes: result.png.byteLength,
        durationMs: durationSince(startedAt),
      };
    } catch {
      return omitted(startedAt, 'render_error', decoded.bytes.byteLength);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.close();
  }
}

class SvgRenderPool {
  private readonly slots: WorkerSlot[] = Array.from(
    {length: PI_SVG_RASTERIZATION_LIMITS.maxWorkers},
    () => ({
      worker: undefined,
      ready: false,
      task: undefined,
      timer: undefined,
      replacing: false,
      termination: undefined,
    }),
  );
  private readonly queue: RenderTask[] = [];
  private readonly workerFactory: WorkerFactory;
  private readonly workerUrl: URL;
  private nextTaskId = 1;
  private closed = false;

  constructor(options: {workerFactory: WorkerFactory; workerUrl: URL}) {
    this.workerFactory = options.workerFactory;
    this.workerUrl = options.workerUrl;
  }

  render(
    bytes: Uint8Array,
    deadlineMs: number = PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs,
  ): Promise<PoolResult> {
    const budgetMs = boundedBudget(deadlineMs);
    const deadlineAt = performance.now() + budgetMs;
    return new Promise((resolve) => {
      if (this.closed) {
        resolve({ok: false, reason: 'rasterizer_unavailable'});
        return;
      }
      const queuedBeyondInitializingWorkers = this.queue.length - this.initializingWorkerCount();
      if (queuedBeyondInitializingWorkers >= PI_SVG_RASTERIZATION_LIMITS.maxQueuedRenders) {
        resolve({ok: false, reason: 'pool_saturated'});
        return;
      }

      const task: RenderTask = {
        id: this.nextTaskId++,
        bytes,
        deadlineAt,
        resolve,
        queueTimer: undefined,
      };
      this.queue.push(task);
      this.scheduleQueueDeadline(task);
      this.drain();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.queue.splice(0)) {
      if (task.queueTimer !== undefined) clearTimeout(task.queueTimer);
      task.resolve({ok: false, reason: 'rasterizer_unavailable'});
    }

    const terminations: Promise<void>[] = [];
    for (const slot of this.slots) {
      if (slot.timer !== undefined) clearTimeout(slot.timer);
      slot.timer = undefined;
      if (slot.task !== undefined) {
        slot.task.resolve({ok: false, reason: 'rasterizer_unavailable'});
        slot.task = undefined;
      }
      if (slot.termination !== undefined) terminations.push(slot.termination);
      const worker = slot.worker;
      slot.worker = undefined;
      if (worker === undefined) continue;
      const termination = terminateWorker(worker);
      slot.termination = termination;
      terminations.push(termination);
    }
    await Promise.all(terminations);
  }

  private drain(): void {
    if (this.closed) return;
    while (this.queue.length > 0) {
      const slot = this.availableSlot();
      if (slot === undefined) {
        if (this.initializingWorkerCount() >= this.queue.length) return;
        const emptySlot = this.emptySlot();
        if (emptySlot === undefined) return;
        this.startWorker(emptySlot);
        continue;
      }
      const task = this.queue.shift();
      if (task === undefined) return;
      if (task.queueTimer !== undefined) clearTimeout(task.queueTimer);
      task.queueTimer = undefined;
      this.dispatch(slot, task);
    }
  }

  private availableSlot(): WorkerSlot | undefined {
    return this.slots.find((slot) => !slot.replacing && slot.ready && slot.task === undefined);
  }

  private emptySlot(): WorkerSlot | undefined {
    return this.slots.find((slot) => !slot.replacing && slot.worker === undefined);
  }

  private initializingWorkerCount(): number {
    return this.slots.filter((slot) => !slot.replacing && slot.worker !== undefined && !slot.ready)
      .length;
  }

  private startWorker(slot: WorkerSlot): void {
    try {
      const worker = this.workerFactory(this.workerUrl);
      slot.worker = worker;
      slot.ready = false;
      attachWorker(this, slot, worker);
    } catch {
      this.resolveNextQueuedTask({ok: false, reason: 'render_error'});
    }
  }

  private dispatch(slot: WorkerSlot, task: RenderTask): void {
    const remainingMs = task.deadlineAt - performance.now();
    if (remainingMs <= 0) {
      task.resolve({ok: false, reason: 'result_budget_exhausted'});
      this.drain();
      return;
    }

    const worker = slot.worker;
    if (worker === undefined || !slot.ready) {
      task.resolve({ok: false, reason: 'render_error'});
      this.drain();
      return;
    }

    slot.task = task;
    const timeoutMs = Math.min(PI_SVG_RASTERIZATION_LIMITS.workerDeadlineMs, remainingMs);
    const budgetTimeout = remainingMs <= PI_SVG_RASTERIZATION_LIMITS.workerDeadlineMs;
    slot.timer = setTimeout(
      () => this.failTimedOutTask(slot, worker as RenderWorker, task, budgetTimeout),
      timeoutMs,
    );

    const svg = arrayBufferOf(task.bytes);
    const message: WorkerMessage = {type: 'render', requestId: task.id, svg};
    try {
      worker.postMessage(message, [svg]);
    } catch {
      this.finishTask(slot, worker, task, {ok: false, reason: 'render_error'}, true);
    }
  }

  private failTimedOutTask(
    slot: WorkerSlot,
    worker: RenderWorker,
    task: RenderTask,
    budgetTimeout = false,
  ): void {
    if (slot.worker !== worker || slot.task !== task) return;
    this.finishTask(
      slot,
      worker,
      task,
      {
        ok: false,
        reason:
          budgetTimeout || performance.now() >= task.deadlineAt
            ? 'result_budget_exhausted'
            : 'render_timeout',
      },
      true,
    );
  }

  private finishTask(
    slot: WorkerSlot,
    worker: RenderWorker,
    task: RenderTask,
    result: PoolResult,
    replaceWorker: boolean,
  ): void {
    if (slot.worker !== worker || slot.task !== task) return;
    if (slot.timer !== undefined) clearTimeout(slot.timer);
    slot.timer = undefined;
    slot.task = undefined;
    task.resolve(result);
    if (replaceWorker) this.replaceWorker(slot, worker);
    this.drain();
  }

  private replaceWorker(slot: WorkerSlot, worker: RenderWorker): void {
    if (slot.worker !== worker) return;
    slot.worker = undefined;
    slot.ready = false;
    slot.replacing = true;
    const termination = terminateWorker(worker);
    slot.termination = termination;
    void termination.then(() => {
      if (slot.termination === termination) slot.termination = undefined;
      slot.replacing = false;
      if (this.closed) return;
      this.drain();
    });
  }

  handleWorkerMessage(slot: WorkerSlot, worker: RenderWorker, value: unknown): void {
    if (slot.worker !== worker) return;
    if (!slot.ready) {
      if (isWorkerStartupResponse(value) && value.type === 'ready') {
        slot.ready = true;
        this.drain();
        return;
      }
      this.resolveNextQueuedTask({
        ok: false,
        reason:
          isWorkerStartupResponse(value) && value.type === 'initialization_failed'
            ? 'rasterizer_unavailable'
            : 'render_error',
      });
      this.replaceWorker(slot, worker);
      this.drain();
      return;
    }

    const task = slot.task;
    if (task === undefined) return;
    if (!isWorkerRenderResponse(value) || value.requestId !== task.id) {
      this.finishTask(slot, worker, task, {ok: false, reason: 'render_error'}, true);
      return;
    }
    if (performance.now() >= task.deadlineAt) {
      this.failTimedOutTask(slot, worker, task);
      return;
    }
    if (value.type === 'failed') {
      this.finishTask(
        slot,
        worker,
        task,
        {ok: false, reason: mapWorkerFailure(value.reason)},
        shouldReplaceAfterFailure(value.reason),
      );
      return;
    }

    const png = new Uint8Array(value.png);
    const validation = validatePngOutput(png, PI_SVG_RASTERIZATION_LIMITS);
    if (!validation.ok) {
      this.finishTask(
        slot,
        worker,
        task,
        {ok: false, reason: validation.reason},
        validation.reason !== 'output_too_large',
      );
      return;
    }
    this.finishTask(
      slot,
      worker,
      task,
      {ok: true, png, width: validation.width, height: validation.height},
      false,
    );
  }

  handleWorkerError(slot: WorkerSlot, worker: RenderWorker): void {
    if (slot.worker !== worker) return;
    if (!slot.ready) {
      this.resolveNextQueuedTask({ok: false, reason: 'rasterizer_unavailable'});
      this.replaceWorker(slot, worker);
      this.drain();
      return;
    }
    const task = slot.task;
    if (task === undefined) {
      this.replaceWorker(slot, worker);
      return;
    }
    this.finishTask(slot, worker, task, {ok: false, reason: 'render_error'}, true);
  }

  handleWorkerExit(slot: WorkerSlot, worker: RenderWorker): void {
    if (slot.worker !== worker) return;
    if (!slot.ready) {
      this.resolveNextQueuedTask({ok: false, reason: 'rasterizer_unavailable'});
      this.replaceWorker(slot, worker);
      this.drain();
      return;
    }
    const task = slot.task;
    if (task === undefined) {
      this.replaceWorker(slot, worker);
      return;
    }
    this.finishTask(slot, worker, task, {ok: false, reason: 'render_error'}, true);
  }

  private scheduleQueueDeadline(task: RenderTask): void {
    const remainingMs = task.deadlineAt - performance.now();
    if (remainingMs <= 0) {
      const index = this.queue.indexOf(task);
      if (index >= 0) this.queue.splice(index, 1);
      task.resolve({ok: false, reason: 'result_budget_exhausted'});
      return;
    }
    task.queueTimer = setTimeout(() => {
      const index = this.queue.indexOf(task);
      if (index < 0) return;
      this.queue.splice(index, 1);
      task.queueTimer = undefined;
      task.resolve({ok: false, reason: 'result_budget_exhausted'});
      this.discardSurplusInitializingWorkers();
      this.drain();
    }, remainingMs);
  }

  private discardSurplusInitializingWorkers(): void {
    let surplus = this.initializingWorkerCount() - this.queue.length;
    if (surplus <= 0) return;
    for (const slot of this.slots) {
      const worker = slot.worker;
      if (surplus <= 0) return;
      if (slot.replacing || worker === undefined || slot.ready) continue;
      this.replaceWorker(slot, worker);
      surplus -= 1;
    }
  }

  private resolveNextQueuedTask(result: PoolResult): void {
    const task = this.queue.shift();
    if (task === undefined) return;
    if (task.queueTimer !== undefined) clearTimeout(task.queueTimer);
    task.queueTimer = undefined;
    task.resolve(result);
  }
}

function attachWorker(pool: SvgRenderPool, slot: WorkerSlot, worker: RenderWorker): void {
  worker.on('message', (value: unknown) => pool.handleWorkerMessage(slot, worker, value));
  worker.on('error', () => pool.handleWorkerError(slot, worker));
  worker.on('exit', () => pool.handleWorkerExit(slot, worker));
  worker.unref?.();
}

function terminateWorker(worker: RenderWorker): Promise<void> {
  worker.removeAllListeners();
  worker.on('error', ignoreWorkerError);
  return Promise.resolve()
    .then(() => worker.terminate())
    .catch(() => undefined)
    .then(() => {
      worker.removeAllListeners();
    });
}

function ignoreWorkerError(): void {
  return;
}

function isWorkerStartupResponse(value: unknown): value is WorkerStartupResponse {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as {type?: unknown}).type;
  return type === 'ready' || type === 'initialization_failed';
}

function isWorkerRenderResponse(value: unknown): value is WorkerRenderResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    type?: unknown;
    requestId?: unknown;
    png?: unknown;
    reason?: unknown;
  };
  if (
    (candidate.type !== 'rendered' && candidate.type !== 'failed') ||
    typeof candidate.requestId !== 'number' ||
    !Number.isSafeInteger(candidate.requestId) ||
    candidate.requestId <= 0
  ) {
    return false;
  }
  if (candidate.type === 'rendered') return candidate.png instanceof ArrayBuffer;
  return (
    candidate.reason === 'external_resource' ||
    candidate.reason === 'output_too_large' ||
    candidate.reason === 'rasterizer_unavailable' ||
    candidate.reason === 'render_error' ||
    candidate.reason === 'unsafe_svg' ||
    candidate.reason === 'protocol_failure'
  );
}

function shouldReplaceAfterFailure(reason: WorkerFailureReason): boolean {
  return (
    reason === 'rasterizer_unavailable' ||
    reason === 'render_error' ||
    reason === 'protocol_failure'
  );
}

function mapWorkerFailure(reason: WorkerFailureReason): SvgRasterizationReason {
  return reason === 'protocol_failure' ? 'render_error' : reason;
}

function decodeSvgBase64(
  value: string,
):
  | {ok: true; bytes: Uint8Array}
  | {ok: false; reason: 'invalid_base64' | 'input_too_large'; inputBytes?: number} {
  if (typeof value !== 'string' || value.length === 0) {
    return {ok: false, reason: 'invalid_base64'};
  }
  if (value.length > MAX_ENCODED_BASE64_LENGTH) {
    if (!STRICT_BASE64.test(value)) return {ok: false, reason: 'input_too_large'};
    return {
      ok: false,
      reason: 'input_too_large',
      inputBytes: decodedBase64ByteLength(value),
    };
  }
  if (!STRICT_BASE64.test(value)) return {ok: false, reason: 'invalid_base64'};

  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength === 0 || decoded.toString('base64') !== value) {
    return {ok: false, reason: 'invalid_base64'};
  }
  if (decoded.byteLength > PI_SVG_RASTERIZATION_LIMITS.maxInputBytes) {
    return {ok: false, reason: 'input_too_large', inputBytes: decoded.byteLength};
  }
  return {ok: true, bytes: decoded};
}

function decodedBase64ByteLength(value: string): number {
  let padding = 0;
  if (value.endsWith('==')) padding = 2;
  else if (value.endsWith('=')) padding = 1;
  return (value.length / 4) * 3 - padding;
}

function omitted(
  startedAt: number,
  reason: SvgRasterizationReason,
  inputBytes?: number,
): SvgRasterizationResult {
  return {
    outcome: 'omitted',
    reason,
    ...(inputBytes === undefined ? {} : {inputBytes}),
    durationMs: durationSince(startedAt),
  };
}

function assertSmokeRenderConverted(
  label: string,
  result: SvgRasterizationResult,
): asserts result is Extract<SvgRasterizationResult, {outcome: 'converted'}> {
  if (result.outcome === 'converted') return;
  throw new Error(
    `Pi SVG rasterizer smoke render ${label} was omitted: ${result.reason} after ${result.durationMs}ms`,
  );
}

function durationSince(startedAt: number): number {
  return Math.min(
    PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs,
    Math.max(0, Math.round(performance.now() - startedAt)),
  );
}

function boundedBudget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs, value);
}

function defaultWorkerUrl(): URL {
  return existsAsFile(PRODUCTION_WORKER_URL) ? PRODUCTION_WORKER_URL : SOURCE_WORKER_URL;
}

function defaultWorkerFactory(url: URL): RenderWorker {
  const options: WorkerOptions = {
    execArgv: url.pathname.endsWith('.ts') ? ['--experimental-strip-types'] : [],
  };
  return new Worker(url, options);
}

function existsAsFile(url: URL): boolean {
  try {
    return require('node:fs').statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function assertRuntimeAssetsAvailable(): Promise<void> {
  let wasmPath: string;
  try {
    wasmPath = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
  } catch {
    throw new Error('Pi SVG rasterizer WASM asset is unavailable');
  }

  const assets = [
    wasmPath,
    fileURLToPath(PRODUCTION_WORKER_URL),
    ...FONT_ASSET_URLS.map((url) => fileURLToPath(url)),
    fileURLToPath(LICENSE_ASSET_URL),
  ];
  try {
    await Promise.all(assets.map((asset) => access(asset)));
    const license = await readFile(LICENSE_ASSET_URL);
    if (license.byteLength === 0) throw new Error('empty license');
  } catch {
    throw new Error('Pi SVG rasterizer production assets are incomplete');
  }
}

function smokeSvgBase64(withText: boolean): string {
  const text = withText
    ? '<text x="8" y="31" font-family="PiUnknownFamily" font-size="22">Ł</text>'
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect width="160" height="48" fill="#111827"/>${text}</svg>`;
  return Buffer.from(svg).toString('base64');
}
