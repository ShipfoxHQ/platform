import {performance} from 'node:perf_hooks';
import type {ImageContent, TextContent} from '@earendil-works/pi-ai';
import type {ExtensionAPI, InlineExtension} from '@earendil-works/pi-coding-agent';
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
}

type NormalizationBudget = {
  deadlineAt: number;
  svgBlocks: number;
};

/**
 * Creates the normalizer used by the inline Pi extension.
 * Non-SVG tool-result images are returned unchanged without decoding or hashing.
 */
export function createPiToolSvgNormalizer(
  options: PiToolSvgNormalizerOptions = {},
): PiToolSvgNormalizer {
  const normalizer = new PiToolSvgNormalizerImpl(options);
  return {
    normalizeToolResult: (content) => normalizer.normalizeContent(content, 'tool_result'),
  };
}

/** Registers the typed tool-result hook independently of MCP extensions. */
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
          recordUnexpectedFailure(options.warnUnexpectedFailure);
          return {
            ...result,
            content: fallbackSvgContent(event.content, options.recordNormalization),
          };
        }
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

      normalized.push(await this.normalizeSvgBlock(block, source, budget));
      changed = true;
    }

    return changed ? normalized : content;
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
      return converted;
    }

    this.recordDuration('omitted', boundedDuration(result.durationMs));
    if (result.reason === 'render_error' || result.reason === 'rasterizer_unavailable') {
      this.warnUnexpectedFailure(source, result.reason);
    }
    return this.omittedBlock(result.reason, source);
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
  warnUnexpectedFailure: WarnUnexpectedFailure = warnOnUnexpectedFailure,
): void {
  try {
    warnUnexpectedFailure('tool_result', 'render_error');
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
