import {ANNOTATION_STYLE_ICON, ANNOTATION_STYLE_TONE} from '@shipfox/client-ui';
import type {IconName} from '@shipfox/react-ui/icon';
import {RUN_ANNOTATION_SEVERITIES, type RunAnnotationSeverity} from '#core/run-annotation.js';

/**
 * Narrows an annotation-style map to the severities the run surfaces rank and filter by.
 *
 * Built by picking keys rather than by annotating the wider map, so the `default` style cannot
 * ride along invisibly behind the type and reappear the first time a caller iterates these.
 */
function bySeverity<Value>(styleMap: Record<RunAnnotationSeverity, Value>) {
  return Object.fromEntries(
    RUN_ANNOTATION_SEVERITIES.map((severity) => [severity, styleMap[severity]]),
  ) as Record<RunAnnotationSeverity, Value>;
}

/**
 * The glyph vocabulary for annotation severity, shared by every count surface.
 *
 * Derived from the marks the annotation rows render rather than restated, so the glyph beside
 * `1 error` in the summary is the glyph on the error row below it by construction.
 */
export const SEVERITY_ICON: Record<RunAnnotationSeverity, IconName> =
  bySeverity(ANNOTATION_STYLE_ICON);

/**
 * Severity tone lives in the glyph, never in the label.
 *
 * Coloring the text would make severity compete with the brand accent, which this system
 * reserves for links, focus, and "you are here". Shape plus tone in a 12px mark distinguishes
 * an error from a warning without either of them shouting.
 */
export const SEVERITY_ICON_TONE: Record<RunAnnotationSeverity, string> =
  bySeverity(ANNOTATION_STYLE_TONE);

/** Hairline tone for a bordered count chip, matching the glyph it sits beside. */
export const SEVERITY_CHIP_TONE: Record<RunAnnotationSeverity, string> = {
  error: 'border-tag-error-border text-tag-error-icon',
  warning: 'border-tag-warning-border text-tag-warning-icon',
  info: 'border-tag-blue-border text-tag-blue-icon',
  success: 'border-tag-success-border text-tag-success-icon',
};
