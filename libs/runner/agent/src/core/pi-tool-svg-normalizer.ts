import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {ImageContent, TextContent} from '@earendil-works/pi-ai';
import type {
  ContextEvent,
  ExtensionAPI,
  InlineExtension,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import {logger} from '@shipfox/node-opentelemetry';
import {
  PI_SVG_RASTERIZATION_LIMITS,
  rasterizeSvg,
  type SvgRasterizationReason,
  type SvgRasterizationResult,
} from '#core/pi-image-rasterizer.js';
import {
  type PiSvgNormalizationOutcome,
  type PiSvgNormalizationReason,
  type PiSvgNormalizationSource,
  recordPiSvgNormalization,
  recordPiSvgRasterizationDuration,
} from '#metrics/index.js';

export const PI_IMAGE_OMISSION_PLACEHOLDER =
  '[Image omitted: could not be converted to a supported inline image format.]';
export const PI_TOOL_SVG_NORMALIZER_EXTENSION_NAME = 'shipfox-pi-tool-svg-normalizer';

const CANONICAL_SVG_MIME_TYPE = 'image/svg+xml';
const LEGACY_INLINE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const MAX_SVG_BLOCKS_PER_PASS = 20;
const MAX_CACHE_ENTRIES = 32;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const WARNING_INTERVAL_MS = 60_000;
const MAX_ENCODED_BASE64_LENGTH = Math.ceil(PI_SVG_RASTERIZATION_LIMITS.maxInputBytes / 3) * 4;
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type ImageOmissionReason = 'unsupported_format' | SvgRasterizationReason;
export type PiImageContent = TextContent | ImageContent;

type NormalizationClock = () => number;
type RasterizeSvg = (params: {
  base64: string;
  deadlineMs?: number;
}) => Promise<SvgRasterizationResult>;
type RecordNormalization = (
  outcome: PiSvgNormalizationOutcome,
  reason: PiSvgNormalizationReason,
  source: PiSvgNormalizationSource,
) => void;
type RecordDuration = (outcome: PiSvgNormalizationOutcome, durationMs: number) => void;
type WarnUnexpectedFailure = (
  source: PiSvgNormalizationSource,
  reason: 'render_error' | 'rasterizer_unavailable',
) => void;

export interface PiToolSvgNormalizerOptions {
  now?: NormalizationClock;
  rasterize?: RasterizeSvg;
  recordNormalization?: RecordNormalization;
  recordDuration?: RecordDuration;
  warnUnexpectedFailure?: WarnUnexpectedFailure;
}

export interface PiToolSvgNormalizer {
  normalizeToolResult(content: PiImageContent[]): Promise<PiImageContent[]>;
  normalizeContext(messages: ContextEvent['messages']): Promise<ContextEvent['messages']>;
  clear(): void;
}

type NormalizationBudget = {
  deadlineAt: number;
  svgBlocks: number;
};

type PiToolResultExtensionAPI = {
  on(event: 'tool_result', handler: (event: ToolResultEvent) => unknown): void;
};

type CachedSvg = {
  block: PiImageContent;
  outcome: PiSvgNormalizationOutcome;
  reason: PiSvgNormalizationReason;
  weight: number;
};

/**
 * Creates the session-local normalizer used by the inline Pi extension.
 * Non-SVG tool-result images intentionally do not enter this normalizer.
 */
export function createPiToolSvgNormalizer(
  options: PiToolSvgNormalizerOptions = {},
): PiToolSvgNormalizer {
  const normalizer = new SessionPiToolSvgNormalizer(options);
  return {
    normalizeToolResult: (content) => normalizer.normalizeContent(content, 'tool_result'),
    normalizeContext: (messages) => normalizer.normalizeContextMessages(messages),
    clear: () => normalizer.clear(),
  };
}

/** Registers typed tool-result and context hooks independently of MCP extensions. */
export function createPiToolSvgNormalizerExtension(
  options: PiToolSvgNormalizerOptions = {},
): InlineExtension {
  return {
    name: PI_TOOL_SVG_NORMALIZER_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      const normalizer = createPiToolSvgNormalizer(options);

      const toolResultApi = pi as unknown as PiToolResultExtensionAPI;
      toolResultApi.on('tool_result', async (event: ToolResultEvent) => {
        try {
          const content = await normalizer.normalizeToolResult(event.content);
          return {
            content,
            details: event.details,
            isError: event.isError,
            usage: event.usage,
          };
        } catch {
          recordUnexpectedFailure('tool_result', options.warnUnexpectedFailure);
          return {
            content: fallbackSvgContent(event.content, 'tool_result', options.recordNormalization),
            details: event.details,
            isError: event.isError,
            usage: event.usage,
          };
        }
      });
      pi.on('context', async (event) => {
        try {
          return {messages: await normalizer.normalizeContext(event.messages)};
        } catch {
          recordUnexpectedFailure('legacy_context', options.warnUnexpectedFailure);
          return {
            messages: fallbackContextMessages(
              event.messages,
              'legacy_context',
              options.recordNormalization,
            ),
          };
        }
      });
      pi.on('session_shutdown', () => normalizer.clear());
    },
  };
}

class SessionPiToolSvgNormalizer {
  private readonly now: NormalizationClock;
  private readonly rasterize: RasterizeSvg;
  private readonly recordNormalization: RecordNormalization;
  private readonly recordDuration: RecordDuration;
  private readonly warnUnexpectedFailure: WarnUnexpectedFailure;
  private readonly cache = new Map<string, CachedSvg>();
  private cacheBytes = 0;

  constructor(options: PiToolSvgNormalizerOptions) {
    this.now = options.now ?? (() => performance.now());
    this.rasterize = options.rasterize ?? rasterizeSvg;
    const recordNormalization = options.recordNormalization ?? recordPiSvgNormalization;
    this.recordNormalization = (outcome, reason, source) =>
      safelyRecordNormalization(recordNormalization, outcome, reason, source);
    const recordDuration = options.recordDuration ?? recordPiSvgRasterizationDuration;
    this.recordDuration = (outcome, durationMs) => {
      try {
        recordDuration(outcome, durationMs);
      } catch {
        // Metrics must not affect Pi tool results.
      }
    };
    const warnUnexpectedFailure = options.warnUnexpectedFailure ?? warnOnUnexpectedFailure;
    this.warnUnexpectedFailure = (source, reason) => {
      try {
        warnUnexpectedFailure(source, reason);
      } catch {
        // Warnings must not affect Pi tool results.
      }
    };
  }

  normalizeContent(
    content: PiImageContent[],
    source: PiSvgNormalizationSource,
  ): Promise<PiImageContent[]> {
    const budget: NormalizationBudget = {
      deadlineAt: this.now() + PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs,
      svgBlocks: 0,
    };
    return this.normalizeContentWithBudget(content, source, budget);
  }

  async normalizeContextMessages(
    messages: ContextEvent['messages'],
  ): Promise<ContextEvent['messages']> {
    const budget: NormalizationBudget = {
      deadlineAt: this.now() + PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs,
      svgBlocks: 0,
    };
    let changed = false;
    const normalized: ContextEvent['messages'] = [];

    for (const message of messages) {
      const content = legacyContentOf(message);
      if (content === undefined) {
        normalized.push(message);
        continue;
      }

      const nextContent = await this.normalizeContentWithBudget(content, 'legacy_context', budget);
      if (nextContent === content) {
        normalized.push(message);
        continue;
      }
      normalized.push({...message, content: nextContent} as ContextEvent['messages'][number]);
      changed = true;
    }

    return changed ? normalized : messages;
  }

  clear(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  private async normalizeContentWithBudget(
    content: PiImageContent[],
    source: PiSvgNormalizationSource,
    budget: NormalizationBudget,
  ): Promise<PiImageContent[]> {
    let changed = false;
    const normalized: PiImageContent[] = [];

    for (const block of content) {
      if (block.type !== 'image') {
        normalized.push(block);
        continue;
      }

      const canonicalMimeType = canonicalPiMimeType(block.mimeType);
      if (canonicalMimeType !== CANONICAL_SVG_MIME_TYPE) {
        const nonSvg = this.normalizeNonSvgBlock(block, canonicalMimeType, source);
        normalized.push(nonSvg.block);
        changed ||= nonSvg.changed;
        continue;
      }

      normalized.push(await this.normalizeSvgBlock(block, source, budget));
      changed = true;
    }

    return changed ? normalized : content;
  }

  private normalizeNonSvgBlock(
    block: ImageContent,
    canonicalMimeType: string,
    source: PiSvgNormalizationSource,
  ): {block: PiImageContent; changed: boolean} {
    if (source === 'tool_result') return {block, changed: false};
    if (canonicalMimeType === 'image/jpg') {
      return {block: {...block, mimeType: 'image/jpeg'}, changed: true};
    }
    if (LEGACY_INLINE_IMAGE_MIME_TYPES.has(canonicalMimeType)) {
      return {block, changed: false};
    }
    return {
      block: this.omittedBlock('unsupported_format', source),
      changed: true,
    };
  }

  private async normalizeSvgBlock(
    block: ImageContent,
    source: PiSvgNormalizationSource,
    budget: NormalizationBudget,
  ): Promise<PiImageContent> {
    const svgIndex = budget.svgBlocks;
    budget.svgBlocks += 1;
    if (svgIndex >= MAX_SVG_BLOCKS_PER_PASS) {
      return this.omittedBlock('result_budget_exhausted', source);
    }

    const remainingMs = budget.deadlineAt - this.now();
    if (remainingMs <= 0) {
      return this.omittedBlock('result_budget_exhausted', source);
    }

    const cacheKey = svgCacheKey(block.data);
    const cached = cacheKey === undefined ? undefined : this.getCached(cacheKey);
    if (cached !== undefined) {
      this.recordNormalization(cached.outcome, cached.reason, source);
      if (cached.outcome === 'converted' && cached.block.type === 'image') {
        return {...block, data: cached.block.data, mimeType: cached.block.mimeType};
      }
      return cloneContentBlock(cached.block);
    }

    const result = await this.rasterize({
      base64: block.data,
      deadlineMs: Math.min(remainingMs, PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs),
    });
    if (this.now() > budget.deadlineAt) {
      this.recordDuration('omitted', boundedDuration(result.durationMs));
      return this.omittedBlock('result_budget_exhausted', source);
    }
    if (result.outcome === 'converted') {
      const converted: ImageContent = {
        ...block,
        data: Buffer.from(result.png).toString('base64'),
        mimeType: 'image/png',
      };
      this.recordNormalization('converted', 'none', source);
      this.recordDuration('converted', boundedDuration(result.durationMs));
      if (cacheKey !== undefined) {
        this.setCached(cacheKey, {
          block: converted,
          outcome: 'converted',
          reason: 'none',
          weight: Buffer.byteLength(converted.data, 'utf8'),
        });
      }
      return converted;
    }

    this.recordDuration('omitted', boundedDuration(result.durationMs));
    if (result.reason === 'render_error' || result.reason === 'rasterizer_unavailable') {
      this.warnUnexpectedFailure(source, result.reason);
    }
    const omitted = this.omittedBlock(result.reason, source);
    if (cacheKey !== undefined && isStableOmission(result.reason)) {
      this.setCached(cacheKey, {
        block: omitted,
        outcome: 'omitted',
        reason: result.reason,
        weight: Buffer.byteLength(PI_IMAGE_OMISSION_PLACEHOLDER, 'utf8'),
      });
    }
    return omitted;
  }

  private omittedBlock(reason: ImageOmissionReason, source: PiSvgNormalizationSource): TextContent {
    this.recordNormalization('omitted', reason, source);
    return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER};
  }

  private getCached(key: string): CachedSvg | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private setCached(key: string, entry: CachedSvg): void {
    if (entry.weight > MAX_CACHE_BYTES) return;
    const previous = this.cache.get(key);
    if (previous !== undefined) this.cacheBytes -= previous.weight;
    this.cache.delete(key);
    while (
      this.cache.size >= MAX_CACHE_ENTRIES ||
      this.cacheBytes + entry.weight > MAX_CACHE_BYTES
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      if (oldest !== undefined) this.cacheBytes -= oldest.weight;
    }
    this.cache.set(key, entry);
    this.cacheBytes += entry.weight;
  }
}

function canonicalPiMimeType(value: string): string {
  if (typeof value !== 'string') return '';
  const parameterIndex = value.indexOf(';');
  return value
    .slice(0, parameterIndex < 0 ? value.length : parameterIndex)
    .trim()
    .toLowerCase();
}

function legacyContentOf(message: ContextEvent['messages'][number]): PiImageContent[] | undefined {
  if (
    (message.role !== 'user' && message.role !== 'toolResult') ||
    !Array.isArray(message.content)
  ) {
    return undefined;
  }
  return message.content as PiImageContent[];
}

function fallbackSvgContent(
  content: PiImageContent[],
  source: PiSvgNormalizationSource,
  recordNormalization: RecordNormalization = recordPiSvgNormalization,
): PiImageContent[] {
  let changed = false;
  const fallback = content.map((block) => {
    if (block.type !== 'image' || canonicalPiMimeType(block.mimeType) !== CANONICAL_SVG_MIME_TYPE) {
      return block;
    }
    changed = true;
    safelyRecordNormalization(recordNormalization, 'omitted', 'render_error', source);
    return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER} satisfies TextContent;
  });
  return changed ? fallback : content;
}

function fallbackContextMessages(
  messages: ContextEvent['messages'],
  source: PiSvgNormalizationSource,
  recordNormalization: RecordNormalization = recordPiSvgNormalization,
): ContextEvent['messages'] {
  let changed = false;
  const fallback = messages.map((message) => {
    const content = legacyContentOf(message);
    if (content === undefined) return message;
    const nextContent = fallbackSvgContent(content, source, recordNormalization);
    if (nextContent === content) return message;
    changed = true;
    return {...message, content: nextContent} as ContextEvent['messages'][number];
  });
  return changed ? fallback : messages;
}

function cloneContentBlock(block: PiImageContent): PiImageContent {
  return {...block};
}

function svgCacheKey(value: string): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ENCODED_BASE64_LENGTH ||
    !STRICT_BASE64.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.byteLength === 0 ||
    decoded.toString('base64') !== value ||
    decoded.byteLength > PI_SVG_RASTERIZATION_LIMITS.maxInputBytes
  ) {
    return undefined;
  }
  return createHash('sha256')
    .update(CANONICAL_SVG_MIME_TYPE)
    .update('\0')
    .update(decoded)
    .digest('hex');
}

function isStableOmission(reason: SvgRasterizationReason): boolean {
  return (
    reason === 'invalid_base64' ||
    reason === 'input_too_large' ||
    reason === 'unsafe_svg' ||
    reason === 'external_resource' ||
    reason === 'output_too_large'
  );
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs, Math.max(0, Math.round(value)));
}

let lastUnexpectedWarningAt = Number.NEGATIVE_INFINITY;

function warnOnUnexpectedFailure(
  source: PiSvgNormalizationSource,
  reason: 'render_error' | 'rasterizer_unavailable',
): void {
  const now = Date.now();
  if (now - lastUnexpectedWarningAt < WARNING_INTERVAL_MS) return;
  lastUnexpectedWarningAt = now;
  try {
    logger().warn({source, reason}, 'Pi SVG image normalization encountered an unexpected failure');
  } catch {
    // Logging must not affect Pi tool results.
  }
}

function recordUnexpectedFailure(
  source: PiSvgNormalizationSource,
  warnUnexpectedFailure: WarnUnexpectedFailure = warnOnUnexpectedFailure,
): void {
  try {
    warnUnexpectedFailure(source, 'render_error');
  } catch {
    // Warnings must not affect Pi tool results.
  }
}

function safelyRecordNormalization(
  recordNormalization: RecordNormalization,
  outcome: PiSvgNormalizationOutcome,
  reason: PiSvgNormalizationReason,
  source: PiSvgNormalizationSource,
): void {
  try {
    recordNormalization(outcome, reason, source);
  } catch {
    // Metrics must not affect Pi tool results.
  }
}
