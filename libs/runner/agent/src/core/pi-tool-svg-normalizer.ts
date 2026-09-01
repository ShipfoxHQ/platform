import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {ImageContent, TextContent} from '@earendil-works/pi-ai';
import type {ContextEvent, ExtensionAPI, InlineExtension} from '@earendil-works/pi-coding-agent';
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
const MAX_SVG_BLOCKS_PER_PASS = 20;
const WARNING_INTERVAL_MS = 60_000;
const LEGACY_CONTEXT_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const LEGACY_CONTEXT_CACHE_MAX_ENTRIES = 32;
const LEGACY_CONTEXT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const LEGACY_CONTEXT_CACHE_PLACEHOLDER_BYTES = Buffer.byteLength(
  PI_IMAGE_OMISSION_PLACEHOLDER,
  'utf8',
);
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_ENCODED_SVG_BASE64_LENGTH = Math.ceil(PI_SVG_RASTERIZATION_LIMITS.maxInputBytes / 3) * 4;
const STABLE_CONTEXT_OMISSION_REASONS = new Set<ImageOmissionReason>([
  'unsupported_format',
  'invalid_base64',
  'input_too_large',
  'unsafe_svg',
  'external_resource',
  'output_too_large',
]);

export type ImageOmissionReason = 'unsupported_format' | SvgRasterizationReason;
export type PiImageContent = TextContent | ImageContent;

type NormalizationClock = () => number;
type PiAgentMessage = ContextEvent['messages'][number];
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
  normalizeContext(messages: PiAgentMessage[]): Promise<PiAgentMessage[]>;
  clearCache(): void;
}

type NormalizationBudget = {
  deadlineAt: number;
  svgBlocks: number;
};

type NormalizedSvgBlock = {
  block: PiImageContent;
  cacheEntry?: LegacyContextCacheEntry;
  omissionReason?: ImageOmissionReason;
};

type LegacyContextCacheEntry =
  | {kind: 'converted'; data: string; weightBytes: number}
  | {kind: 'omitted'; reason: ImageOmissionReason; weightBytes: number};
type LegacyContextPassCache = Map<string, ImageOmissionReason>;

/**
 * Creates the normalizer used by the inline Pi extension.
 * Non-SVG tool-result images are returned unchanged without decoding or hashing.
 * The legacy-context cache belongs to this normalizer instance. Pi creates a new
 * session object for each later workflow step, so those steps may render the same
 * historical SVG again.
 */
export function createPiToolSvgNormalizer(
  options: PiToolSvgNormalizerOptions = {},
): PiToolSvgNormalizer {
  const normalizer = new PiToolSvgNormalizerImpl(options);
  return {
    normalizeToolResult: (content) => normalizer.normalizeContent(content, 'tool_result'),
    normalizeContext: (messages) => normalizer.normalizeContext(messages),
    clearCache: () => normalizer.clearCache(),
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

      pi.on('tool_result', async (event) => {
        const {
          type: _type,
          toolCallId: _toolCallId,
          input: _input,
          toolName: _toolName,
          ...result
        } = event;
        try {
          const content = await normalizer.normalizeToolResult(event.content);
          return {...result, content};
        } catch {
          recordUnexpectedFailure('tool_result', options.warnUnexpectedFailure);
          return {
            ...result,
            content: fallbackSvgContent(event.content, options.recordNormalization),
          };
        }
      });

      pi.on('context', async (event) => {
        try {
          return {messages: await normalizer.normalizeContext(event.messages)};
        } catch {
          recordUnexpectedFailure('legacy_context', options.warnUnexpectedFailure);
          return {
            messages: fallbackContextMessages(event.messages, options.recordNormalization),
          };
        }
      });

      pi.on('session_shutdown', () => {
        normalizer.clearCache();
      });
    },
  };
}

class PiToolSvgNormalizerImpl {
  private readonly now: NormalizationClock;
  private readonly rasterize: RasterizeSvg;
  private readonly recordNormalization: RecordNormalization;
  private readonly recordDuration: RecordDuration;
  private readonly warnUnexpectedFailure: WarnUnexpectedFailure;
  private readonly legacyContextCache = new LegacyContextLruCache();

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
    const budget = this.createBudget();
    return this.normalizeContentWithBudget(content, source, budget);
  }

  async normalizeContext(messages: PiAgentMessage[]): Promise<PiAgentMessage[]> {
    const budget = this.createBudget();
    const transientCache: LegacyContextPassCache = new Map();
    let changed = false;
    const normalizedMessages: PiAgentMessage[] = [];

    for (const message of messages) {
      const content = contextContentForMessage(message);
      if (content === undefined) {
        normalizedMessages.push(message);
        continue;
      }

      const normalizedContent = await this.normalizeLegacyContent(content, budget, transientCache);
      if (normalizedContent === content) {
        normalizedMessages.push(message);
        continue;
      }

      changed = true;
      normalizedMessages.push(replaceContextMessageContent(message, normalizedContent));
    }

    return changed ? normalizedMessages : messages;
  }

  clearCache(): void {
    this.legacyContextCache.clear();
  }

  private createBudget(): NormalizationBudget {
    return {
      deadlineAt: this.now() + PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs,
      svgBlocks: 0,
    };
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
        normalized.push(block);
        continue;
      }

      const normalizedSvg = await this.normalizeSvgBlock(block, source, budget);
      normalized.push(normalizedSvg.block);
      changed = true;
    }

    return changed ? normalized : content;
  }

  private async normalizeLegacyContent(
    content: readonly unknown[],
    budget: NormalizationBudget,
    transientCache: LegacyContextPassCache,
  ): Promise<readonly unknown[]> {
    let changed = false;
    const normalized: unknown[] = [];

    for (const block of content) {
      if (!isImageBlock(block)) {
        normalized.push(block);
        continue;
      }
      if (!isImageContent(block)) {
        changed = true;
        normalized.push(this.omittedBlock('unsupported_format', 'legacy_context'));
        continue;
      }

      const normalizedImage = await this.normalizeLegacyImage(block, budget, transientCache);
      normalized.push(normalizedImage);
      changed ||= normalizedImage !== block;
    }

    return changed ? normalized : content;
  }

  private async normalizeLegacyImage(
    block: ImageContent,
    budget: NormalizationBudget,
    transientCache: LegacyContextPassCache,
  ): Promise<PiImageContent> {
    const canonicalMimeType = canonicalPiMimeType(block.mimeType);
    const policy = legacyImagePolicy(canonicalMimeType);
    if (policy.kind === 'svg') {
      if (!consumeSvgBudget(budget)) {
        return this.omittedBlock('result_budget_exhausted', 'legacy_context');
      }

      const cacheKey = legacyContextCacheKey(block);
      const transientReason = transientCache.get(cacheKey);
      if (transientReason !== undefined) {
        return this.omittedBlock(transientReason, 'legacy_context');
      }
      const cached = this.legacyContextCache.get(cacheKey);
      if (cached !== undefined) return this.blockFromCache(block, cached);

      const normalizedSvg = await this.normalizeSvgBlock(block, 'legacy_context', budget, true);
      if (normalizedSvg.cacheEntry !== undefined) {
        this.legacyContextCache.set(cacheKey, normalizedSvg.cacheEntry);
      } else if (
        normalizedSvg.omissionReason !== undefined &&
        !isStableContextOmissionReason(normalizedSvg.omissionReason)
      ) {
        transientCache.set(cacheKey, normalizedSvg.omissionReason);
      }
      return normalizedSvg.block;
    }

    if (policy.kind === 'canonicalize') return {...block, mimeType: policy.mimeType};
    if (policy.kind === 'preserve') return block;

    const cacheKey = legacyContextCacheKey(block);
    const cached = this.legacyContextCache.get(cacheKey);
    if (cached !== undefined) return this.blockFromCache(block, cached);

    const omitted = this.omittedBlock('unsupported_format', 'legacy_context');
    this.legacyContextCache.set(cacheKey, {
      kind: 'omitted',
      reason: 'unsupported_format',
      weightBytes: LEGACY_CONTEXT_CACHE_PLACEHOLDER_BYTES,
    });
    return omitted;
  }

  private blockFromCache(block: ImageContent, entry: LegacyContextCacheEntry): PiImageContent {
    if (entry.kind === 'converted') {
      return {...block, data: entry.data, mimeType: 'image/png'};
    }

    return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER};
  }

  private async normalizeSvgBlock(
    block: ImageContent,
    source: PiSvgNormalizationSource,
    budget: NormalizationBudget,
    budgetAlreadyConsumed = false,
  ): Promise<NormalizedSvgBlock> {
    if (!budgetAlreadyConsumed && !consumeSvgBudget(budget)) {
      return {
        block: this.omittedBlock('result_budget_exhausted', source),
        omissionReason: 'result_budget_exhausted',
      };
    }

    const remainingMs = budget.deadlineAt - this.now();
    if (remainingMs <= 0) {
      return {
        block: this.omittedBlock('result_budget_exhausted', source),
        omissionReason: 'result_budget_exhausted',
      };
    }

    let result: SvgRasterizationResult;
    try {
      result = await this.rasterize({
        base64: block.data,
        deadlineMs: Math.min(remainingMs, PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs),
      });
    } catch {
      this.warnUnexpectedFailure(source, 'render_error');
      return {block: this.omittedBlock('render_error', source), omissionReason: 'render_error'};
    }
    if (this.now() > budget.deadlineAt) {
      this.recordDuration('omitted', boundedDuration(result.durationMs));
      return {
        block: this.omittedBlock('result_budget_exhausted', source),
        omissionReason: 'result_budget_exhausted',
      };
    }
    if (result.outcome === 'converted') {
      const converted: ImageContent = {
        ...block,
        data: Buffer.from(result.png).toString('base64'),
        mimeType: 'image/png',
      };
      this.recordNormalization('converted', 'none', source);
      this.recordDuration('converted', boundedDuration(result.durationMs));
      return {
        block: converted,
        cacheEntry: {
          kind: 'converted',
          data: converted.data,
          weightBytes: Buffer.byteLength(converted.data, 'utf8'),
        },
      };
    }

    this.recordDuration('omitted', boundedDuration(result.durationMs));
    if (result.reason === 'render_error' || result.reason === 'rasterizer_unavailable') {
      this.warnUnexpectedFailure(source, result.reason);
    }
    const omitted = this.omittedBlock(result.reason, source);
    const cacheEntry = isStableContextOmissionReason(result.reason)
      ? {
          kind: 'omitted' as const,
          reason: result.reason,
          weightBytes: LEGACY_CONTEXT_CACHE_PLACEHOLDER_BYTES,
        }
      : undefined;
    return cacheEntry === undefined
      ? {block: omitted, omissionReason: result.reason}
      : {block: omitted, cacheEntry, omissionReason: result.reason};
  }

  private omittedBlock(reason: ImageOmissionReason, source: PiSvgNormalizationSource): TextContent {
    this.recordNormalization('omitted', reason, source);
    return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER};
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

function contextContentForMessage(message: PiAgentMessage): readonly unknown[] | undefined {
  switch (message.role) {
    case 'user':
    case 'assistant':
    case 'toolResult':
      return Array.isArray(message.content) ? message.content : undefined;
    case 'custom':
      return 'content' in message && Array.isArray(message.content) ? message.content : undefined;
    default:
      return undefined;
  }
}

function replaceContextMessageContent(
  message: PiAgentMessage,
  content: readonly unknown[],
): PiAgentMessage {
  return {...message, content} as PiAgentMessage;
}

function isImageBlock(value: unknown): value is {type: 'image'} {
  return (
    typeof value === 'object' && value !== null && (value as {type?: unknown}).type === 'image'
  );
}

function isImageContent(value: unknown): value is ImageContent {
  return (
    isImageBlock(value) &&
    typeof (value as {data?: unknown}).data === 'string' &&
    typeof (value as {mimeType?: unknown}).mimeType === 'string'
  );
}

type LegacyImagePolicy =
  | {kind: 'svg'}
  | {kind: 'canonicalize'; mimeType: 'image/jpeg'}
  | {kind: 'preserve'}
  | {kind: 'omit'; reason: 'unsupported_format'};

function legacyImagePolicy(canonicalMimeType: string): LegacyImagePolicy {
  if (canonicalMimeType === CANONICAL_SVG_MIME_TYPE) return {kind: 'svg'};
  if (canonicalMimeType === 'image/jpg') {
    return {kind: 'canonicalize', mimeType: 'image/jpeg'};
  }
  if (LEGACY_CONTEXT_ALLOWED_MIME_TYPES.has(canonicalMimeType)) return {kind: 'preserve'};
  return {kind: 'omit', reason: 'unsupported_format'};
}

type CacheSource = {kind: 'decoded'; bytes: Uint8Array} | {kind: 'raw' | 'oversized'; data: string};

function legacyContextCacheKey(block: ImageContent): string {
  const hash = createHash('sha256');
  hash.update(canonicalPiMimeType(block.mimeType), 'utf8');
  hash.update('\0', 'utf8');
  const source = cacheSource(block.data);
  hash.update(source.kind, 'utf8');
  hash.update('\0', 'utf8');
  if (source.kind === 'decoded') hash.update(source.bytes);
  else hash.update(source.data, 'utf8');
  return hash.digest('hex');
}

function cacheSource(value: string): CacheSource {
  if (!STRICT_BASE64.test(value) || value.length === 0) return {kind: 'raw', data: value};
  if (value.length > MAX_ENCODED_SVG_BASE64_LENGTH) {
    return {kind: 'oversized', data: value};
  }

  const decoded = Buffer.from(value, 'base64');
  return decoded.byteLength > 0 && decoded.toString('base64') === value
    ? {kind: 'decoded', bytes: decoded}
    : {kind: 'raw', data: value};
}

function isStableContextOmissionReason(reason: ImageOmissionReason): boolean {
  return STABLE_CONTEXT_OMISSION_REASONS.has(reason);
}

function consumeSvgBudget(budget: NormalizationBudget): boolean {
  const svgIndex = budget.svgBlocks;
  budget.svgBlocks += 1;
  return svgIndex < MAX_SVG_BLOCKS_PER_PASS;
}

class LegacyContextLruCache {
  private readonly entries = new Map<string, LegacyContextCacheEntry>();
  private totalBytes = 0;

  get(key: string): LegacyContextCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: LegacyContextCacheEntry): void {
    if (entry.weightBytes > LEGACY_CONTEXT_CACHE_MAX_BYTES) return;

    this.delete(key);
    while (
      this.entries.size >= LEGACY_CONTEXT_CACHE_MAX_ENTRIES ||
      this.totalBytes + entry.weightBytes > LEGACY_CONTEXT_CACHE_MAX_BYTES
    ) {
      if (!this.evictOldest()) return;
    }

    this.entries.set(key, entry);
    this.totalBytes += entry.weightBytes;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;

    this.entries.delete(key);
    this.totalBytes -= entry.weightBytes;
  }

  private evictOldest(): boolean {
    const oldestKey = this.entries.keys().next().value;
    if (oldestKey === undefined) return false;
    this.delete(oldestKey);
    return true;
  }
}

function fallbackSvgContent(
  content: PiImageContent[],
  recordNormalization: RecordNormalization = recordPiSvgNormalization,
): PiImageContent[] {
  let changed = false;
  const fallback = content.map((block) => {
    if (block.type !== 'image' || canonicalPiMimeType(block.mimeType) !== CANONICAL_SVG_MIME_TYPE) {
      return block;
    }
    changed = true;
    safelyRecordNormalization(recordNormalization, 'omitted', 'render_error', 'tool_result');
    return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER} satisfies TextContent;
  });
  return changed ? fallback : content;
}

function fallbackContextMessages(
  messages: PiAgentMessage[],
  recordNormalization: RecordNormalization = recordPiSvgNormalization,
): PiAgentMessage[] {
  let changed = false;
  const fallback = messages.map((message) => {
    const content = contextContentForMessage(message);
    if (content === undefined) return message;

    let messageChanged = false;
    const normalizedContent = content.map((block) => {
      if (!isImageBlock(block)) return block;
      if (!isImageContent(block)) {
        messageChanged = true;
        safelyRecordNormalization(
          recordNormalization,
          'omitted',
          'unsupported_format',
          'legacy_context',
        );
        return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER} satisfies TextContent;
      }

      const canonicalMimeType = canonicalPiMimeType(block.mimeType);
      const policy = legacyImagePolicy(canonicalMimeType);
      if (policy.kind === 'svg') {
        messageChanged = true;
        safelyRecordNormalization(recordNormalization, 'omitted', 'render_error', 'legacy_context');
        return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER} satisfies TextContent;
      }
      if (policy.kind === 'canonicalize') {
        messageChanged = true;
        return {...block, mimeType: policy.mimeType};
      }
      if (policy.kind === 'preserve') return block;

      messageChanged = true;
      safelyRecordNormalization(
        recordNormalization,
        'omitted',
        'unsupported_format',
        'legacy_context',
      );
      return {type: 'text', text: PI_IMAGE_OMISSION_PLACEHOLDER} satisfies TextContent;
    });

    if (!messageChanged) return message;
    changed = true;
    return replaceContextMessageContent(message, normalizedContent);
  });
  return changed ? fallback : messages;
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PI_SVG_RASTERIZATION_LIMITS.resultBudgetMs, Math.max(0, Math.round(value)));
}

const lastUnexpectedWarningAt = new Map<PiSvgNormalizationSource, number>();

function warnOnUnexpectedFailure(
  source: PiSvgNormalizationSource,
  reason: 'render_error' | 'rasterizer_unavailable',
): void {
  const now = Date.now();
  const previousWarningAt = lastUnexpectedWarningAt.get(source) ?? Number.NEGATIVE_INFINITY;
  if (now - previousWarningAt < WARNING_INTERVAL_MS) return;
  lastUnexpectedWarningAt.set(source, now);
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
