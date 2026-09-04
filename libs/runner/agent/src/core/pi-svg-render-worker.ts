import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {parentPort} from 'node:worker_threads';
import {type CustomFontsOptions, initWasm, Resvg} from '@resvg/resvg-wasm';
import type {
  SvgRenderWorkerRenderResponse,
  SvgRenderWorkerRequest,
  SvgRenderWorkerResponse,
} from './pi-svg-render-protocol.js';

const sourceExtension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const {validatePngOutput} = await import(`./pi-png.${sourceExtension}`);
const {inspectSvgPolicy} = await import(`./pi-svg-policy.${sourceExtension}`);
const {PI_SVG_FONT_ASSET_FILENAMES, PI_SVG_RASTERIZATION_LIMITS} = (await import(
  `./pi-svg-render-config.${sourceExtension}`
)) as typeof import('./pi-svg-render-config.js');
const {readFontFamily} = (await import(
  `./pi-svg-font.${sourceExtension}`
)) as typeof import('./pi-svg-font.js');
const FONT_URLS = PI_SVG_FONT_ASSET_FILENAMES.map(
  (filename) => new URL(`../assets/pi-svg/${filename}`, import.meta.url),
);

const require = createRequire(import.meta.url);
let fontBuffers: Uint8Array[] | undefined;
let fontFamily: string | undefined;
let initialization: Promise<void> | undefined;

if (parentPort === null) throw new Error('SVG render worker has no parent port');
const port = parentPort;

await startWorker();

async function startWorker(): Promise<void> {
  try {
    await initializeRenderer();
  } catch {
    post({type: 'initialization_failed'});
    return;
  }

  port.on('message', (message: unknown) => {
    handleMessage(message);
  });
  post({type: 'ready'});
}

function handleMessage(message: unknown): void {
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
    const response = renderSvg(requestId, svg);
    if (response.type === 'rendered') port.postMessage(response, [response.png]);
    else post(response);
  } catch {
    post({type: 'failed', requestId, reason: 'render_error'});
  }
}

function renderSvg(requestId: number, svg: Uint8Array): SvgRenderWorkerRenderResponse {
  const renderer = new Resvg(svg, {
    font: fontOptions(),
  });

  try {
    if (renderer.imagesToResolve().length > 0) {
      return {type: 'failed', requestId, reason: 'external_resource'};
    }

    const scale = scaleForDimensions(renderer.width, renderer.height);
    if (scale === undefined) return {type: 'failed', requestId, reason: 'render_error'};

    if (scale === 1) return renderPng(requestId, renderer);

    const scaledRenderer = new Resvg(svg, {
      fitTo: {mode: 'zoom', value: scale},
      font: fontOptions(),
    });
    try {
      if (scaledRenderer.imagesToResolve().length > 0) {
        return {type: 'failed', requestId, reason: 'external_resource'};
      }
      return renderPng(requestId, scaledRenderer);
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

  const edgeScale = Math.min(
    1,
    PI_SVG_RASTERIZATION_LIMITS.maxOutputEdge / width,
    PI_SVG_RASTERIZATION_LIMITS.maxOutputEdge / height,
  );
  const pixelScale = Math.min(1, Math.sqrt(PI_SVG_RASTERIZATION_LIMITS.maxOutputPixels / pixels));
  const scale = Math.min(edgeScale, pixelScale);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  return scale;
}

async function initializeRenderer(): Promise<void> {
  initialization ??= loadRendererAssets();
  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
}

async function loadRendererAssets(): Promise<void> {
  const wasmPath = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
  const [wasm, ...fonts] = await Promise.all([
    readFile(wasmPath),
    ...FONT_URLS.map((url) => readFile(url)),
  ]);
  const families = fonts.map((font) => readFontFamily(font));
  const firstFamily = families[0];
  if (firstFamily === undefined || families.some((family) => family !== firstFamily)) {
    throw new Error('SVG renderer font families are inconsistent');
  }
  await initWasm(wasm);
  fontBuffers = fonts;
  fontFamily = firstFamily;
}

function fontOptions(): CustomFontsOptions {
  if (fontBuffers === undefined || fontFamily === undefined) {
    throw new Error('SVG renderer fonts are unavailable');
  }
  return {
    fontBuffers,
    defaultFontFamily: fontFamily,
    serifFamily: fontFamily,
    sansSerifFamily: fontFamily,
    cursiveFamily: fontFamily,
    fantasyFamily: fontFamily,
    monospaceFamily: fontFamily,
  };
}

function renderPng(
  requestId: number,
  renderer: InstanceType<typeof Resvg>,
): SvgRenderWorkerRenderResponse {
  const rendered = renderer.render();
  try {
    const png = rendered.asPng();
    const validation = validatePngOutput(png, PI_SVG_RASTERIZATION_LIMITS);
    if (!validation.ok) return {type: 'failed', requestId, reason: validation.reason};

    const transferred = png.slice().buffer as ArrayBuffer;
    return {type: 'rendered', requestId, png: transferred};
  } finally {
    rendered.free();
  }
}

function isRenderRequest(value: unknown): value is SvgRenderWorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SvgRenderWorkerRequest>;
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

function post(response: SvgRenderWorkerResponse): void {
  port.postMessage(response);
}
