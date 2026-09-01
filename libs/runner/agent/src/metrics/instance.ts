import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {ImageOmissionReason} from '#core/pi-tool-svg-normalizer.js';

export type PiSvgNormalizationOutcome = 'converted' | 'omitted';
export type PiSvgNormalizationSource = 'tool_result';
export type PiSvgNormalizationReason = 'none' | ImageOmissionReason;

const meter = instanceMetrics.getMeter('runner-agent');

const piSvgNormalizationCount = meter.createCounter<{
  outcome: PiSvgNormalizationOutcome;
  reason: PiSvgNormalizationReason;
  source: PiSvgNormalizationSource;
}>('runner_agent_pi_svg_normalization', {
  description: 'Pi SVG image normalization outcomes by bounded reason and source',
});

const piSvgRasterizationDuration = meter.createHistogram<{
  outcome: PiSvgNormalizationOutcome;
}>('runner_agent_pi_svg_rasterization_duration', {
  description: 'Bounded duration of Pi SVG rasterization attempts',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [0, 10, 50, 100, 250, 500, 1_000, 2_000, 5_000],
  },
});

export function recordPiSvgNormalization(
  outcome: PiSvgNormalizationOutcome,
  reason: PiSvgNormalizationReason,
  source: PiSvgNormalizationSource,
): void {
  try {
    piSvgNormalizationCount.add(1, {outcome, reason, source});
  } catch {
    // Metrics must not affect Pi tool results.
  }
}

export function recordPiSvgRasterizationDuration(
  outcome: PiSvgNormalizationOutcome,
  durationMs: number,
): void {
  try {
    piSvgRasterizationDuration.record(durationMs, {outcome});
  } catch {
    // Metrics must not affect Pi tool results.
  }
}
