import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {parentPort} from 'node:worker_threads';
import {type CustomFontsOptions, initWasm, Resvg} from '@resvg/resvg-wasm';

const sourceExtension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const {validatePngOutput} = await import(`./pi-png.${sourceExtension}`);
const {inspectSvgPolicy} = await import(`./pi-svg-policy.${sourceExtension}`);

const MAX_OUTPUT_EDGE = 2_000;
const MAX_OUTPUT_PIXELS = 4_000_000;
const MAX_PNG_BYTES = 3 * 1024 * 1024;
const RENDER_LIMITS = {
  maxOutputEdge: MAX_OUTPUT_EDGE,
  maxOutputPixels: MAX_OUTPUT_PIXELS,
  maxPngBytes: MAX_PNG_BYTES,
};
const FONT_FAMILY = 'IBM Plex Sans';
const FONT_URLS = [
  new URL('../assets/pi-svg/ibm-plex-sans-var-roman-latin1.woff2', import.meta.url),
  new URL('../assets/pi-svg/ibm-plex-sans-var-roman-latin2.woff2', import.meta.url),
  new URL('../assets/pi-svg/ibm-plex-sans-var-roman-latin3.woff2', import.meta.url),
  new URL('../assets/pi-svg/ibm-plex-sans-var-roman-pi.woff2', import.meta.url),
] as const;

const require = createRequire(import.meta.url);
let fontBuffers: Uint8Array[] | undefined;
let initialization: Promise<void> | undefined;

type RenderRequest = {type: 'render'; requestId: number; svg: ArrayBuffer};
type WorkerFailureReason =
  | 'external_resource'
  | 'output_too_large'
  | 'rasterizer_unavailable'
  | 'render_error'
  | 'unsafe_svg'
  | 'protocol_failure';
type RenderResponse =
  | {type: 'rendered'; requestId: number; png: ArrayBuffer}
  | {type: 'failed'; requestId: number; reason: WorkerFailureReason};

if (parentPort === null) throw new Error('SVG render worker has no parent port');
const port = parentPort;

port.on('message', (message: unknown) => {
  void handleMessage(message);
});

async function handleMessage(message: unknown): Promise<void> {
  const requestId = requestIdOf(message);
  if (!isRenderRequest(message)) {
    post({type: 'failed', requestId, reason: 'protocol_failure'});
    return;
  }

  const svg = new Uint8Array(message.svg);
  const policyRejection = inspectSvgPolicy(svg);
  if (policyRejection !== undefined) {
    post({type: 'failed', requestId, reason: policyRejection});
    return;
  }

  try {
    await initializeRenderer();
  } catch {
    post({type: 'failed', requestId, reason: 'rasterizer_unavailable'});
    return;
  }

  try {
    const response = renderSvg(requestId, svg);
    if (response.type === 'rendered') port.postMessage(response, [response.png]);
    else post(response);
  } catch {
    post({type: 'failed', requestId, reason: 'render_error'});
  }
}

function renderSvg(requestId: number, svg: Uint8Array): RenderResponse {
  const renderer = new Resvg(svg, {
    font: fontOptions(),
  });

  try {
    if (renderer.imagesToResolve().length > 0) {
      return {type: 'failed', requestId, reason: 'external_resource'};
    }

    const scale = scaleForDimensions(renderer.width, renderer.height);
    if (scale === undefined) return {type: 'failed', requestId, reason: 'render_error'};

    const scaledRenderer = new Resvg(svg, {
      fitTo: {mode: 'zoom', value: scale},
      font: fontOptions(),
    });
    try {
      if (scaledRenderer.imagesToResolve().length > 0) {
        return {type: 'failed', requestId, reason: 'external_resource'};
      }
      const rendered = scaledRenderer.render();
      try {
        const png = rendered.asPng();
        const validation = validatePngOutput(png, RENDER_LIMITS);
        if (!validation.ok) return {type: 'failed', requestId, reason: validation.reason};

        const transferred = Uint8Array.from(png).buffer;
        return {type: 'rendered', requestId, png: transferred};
      } finally {
        rendered.free();
      }
    } finally {
      scaledRenderer.free();
    }
  } finally {
    renderer.free();
  }
}

function scaleForDimensions(width: number, height: number): number | undefined {
  const pixels = width * height;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(pixels) ||
    pixels <= 0
  ) {
    return undefined;
  }

  const edgeScale = Math.min(1, MAX_OUTPUT_EDGE / width, MAX_OUTPUT_EDGE / height);
  const pixelScale = Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / pixels));
  const scale = Math.min(edgeScale, pixelScale);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  return scale;
}

async function initializeRenderer(): Promise<void> {
  initialization ??= loadRendererAssets();
  await initialization;
}

async function loadRendererAssets(): Promise<void> {
  const wasmPath = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
  const [wasm, ...fonts] = await Promise.all([
    readFile(wasmPath),
    ...FONT_URLS.map((url) => readFile(url)),
  ]);
  await initWasm(wasm);
  fontBuffers = fonts;
}

function fontOptions(): CustomFontsOptions {
  if (fontBuffers === undefined) throw new Error('SVG renderer fonts are unavailable');
  return {
    fontBuffers,
    defaultFontFamily: FONT_FAMILY,
    serifFamily: FONT_FAMILY,
    sansSerifFamily: FONT_FAMILY,
    cursiveFamily: FONT_FAMILY,
    fantasyFamily: FONT_FAMILY,
    monospaceFamily: FONT_FAMILY,
  };
}

function isRenderRequest(value: unknown): value is RenderRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RenderRequest>;
  return (
    candidate.type === 'render' &&
    typeof candidate.requestId === 'number' &&
    Number.isSafeInteger(candidate.requestId) &&
    candidate.requestId > 0 &&
    candidate.svg instanceof ArrayBuffer
  );
}

function requestIdOf(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  const requestId = (value as {requestId?: unknown}).requestId;
  return typeof requestId === 'number' && Number.isSafeInteger(requestId) && requestId > 0
    ? requestId
    : 0;
}

function post(response: RenderResponse): void {
  port.postMessage(response);
}
