import type {IconName} from '@shipfox/react-ui/icon';
import type {RunAnnotationSeverity} from '#core/run-annotation.js';

/**
 * The glyph vocabulary for annotation severity, shared by every count surface.
 *
 * Deliberately the same marks the `Callout` uses on the cards themselves, so the glyph beside
 * `1 error` in the summary is the glyph on the error card below it.
 */
export const SEVERITY_ICON: Record<RunAnnotationSeverity, IconName> = {
  error: 'closeCircleFill',
  warning: 'errorWarningFill',
  info: 'info',
  success: 'checkboxCircleFill',
};

/**
 * Severity tone lives in the glyph, never in the label.
 *
 * Coloring the text would make severity compete with the brand accent, which this system
 * reserves for links, focus, and "you are here". Shape plus tone in a 12px mark distinguishes
 * an error from a warning without either of them shouting.
 */
export const SEVERITY_ICON_TONE: Record<RunAnnotationSeverity, string> = {
  error: 'text-tag-error-icon',
  warning: 'text-tag-warning-icon',
  info: 'text-tag-blue-icon',
  success: 'text-tag-success-icon',
};

/** Hairline tone for a bordered count chip, matching the glyph it sits beside. */
export const SEVERITY_CHIP_TONE: Record<RunAnnotationSeverity, string> = {
  error: 'border-tag-error-border text-tag-error-icon',
  warning: 'border-tag-warning-border text-tag-warning-icon',
  info: 'border-tag-blue-border text-tag-blue-icon',
  success: 'border-tag-success-border text-tag-success-icon',
};
