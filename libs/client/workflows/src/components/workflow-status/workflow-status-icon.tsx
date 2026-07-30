import {Dot, type DotVariant} from '@shipfox/react-ui/dot';
import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {cn} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import {getWorkflowStatusVisual, type WorkflowDisplayStatus} from './status-visuals.js';

// Status glyphs use the same saturated accent tokens as IconBadge/StatusBadge.
const toneByVariant: Record<DotVariant, string> = {
  neutral: 'text-tag-neutral-icon',
  info: 'text-tag-blue-icon',
  feature: 'text-tag-purple-icon',
  success: 'text-tag-success-icon',
  warning: 'text-tag-warning-icon',
  error: 'text-tag-error-icon',
};

// Terminal states are self-contained solid discs; the shape names the state. Running and
// pending render their own shapes (the live Dot and a bold ring), so they aren't here.
const glyphByKind: Partial<Record<WorkflowDisplayStatus, IconName>> = {
  succeeded: 'checkCircleSolid',
  failed: 'xCircleSolid',
  cancelled: 'forbid2Fill',
  skipped: 'forbid2Fill',
};

// The solid discs fill ~90-95% of their viewBox and forbid2Fill ~83%, so one numeric size
// renders different diameters. These multipliers land every disc at the running Dot's diameter.
const glyphScale: Partial<Record<IconName, number>> = {
  checkCircleSolid: 1.12,
  xCircleSolid: 1.06,
  forbid2Fill: 1.22,
};

// Only the two sizes the app uses are mapped; both are literal strings so Tailwind emits them.
const dotSizeClass: Record<number, string> = {
  12: 'size-12',
  14: 'size-14',
  20: 'size-20',
};

// Pending is a neutral ring: a filled disc with a transparent center punched out by a radial
// mask. Reads as "not started" and stays visually consistent with the solid discs - much
// bolder than a dotted outline. Tune the mask stops to make the band thicker or thinner.
const PENDING_RING_MASK = 'radial-gradient(circle closest-side, transparent 0 52%, #000 56%)';

export interface WorkflowStatusIconProps {
  status: WorkflowDisplayStatus;
  /** Optical diameter in px: 14 in the DAG node and run row. */
  size?: number;
  /** Pulsing halo for the running state. */
  ripple?: boolean;
  /**
   * Wrap the indicator in a hover tooltip naming the status. Defaults on. Pass false where
   * the status text is already visible next to it (the DAG node) to avoid a redundant tooltip.
   */
  tooltip?: boolean;
  className?: string;
}

/**
 * The job/run/step state indicator: an icon-in-circle glyph whose shape (not just color)
 * names the state. Carries the status as its accessible name (`role="img"`) and, by default,
 * a hover tooltip, so the state is reachable by pointer and assistive tech everywhere.
 */
export function WorkflowStatusIcon({
  status,
  size = 14,
  ripple = true,
  tooltip = true,
  className,
}: WorkflowStatusIconProps) {
  const visual = getWorkflowStatusVisual(status);
  const box = dotSizeClass[size] ?? 'size-14';

  let glyph: ReactNode;
  if (visual.kind === 'listening') {
    glyph = (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full bg-current',
          box,
          toneByVariant.info,
        )}
      >
        <Icon name="pulseLine" size={Math.max(8, Math.round(size * 0.7))} className="text-white" />
      </span>
    );
  } else if (visual.kind === 'running') {
    glyph = <Dot variant="info" ripple={ripple} className={box} />;
  } else if (visual.kind === 'pending') {
    glyph = (
      <span
        className={cn('rounded-full bg-current', box, toneByVariant.neutral)}
        style={{maskImage: PENDING_RING_MASK, WebkitMaskImage: PENDING_RING_MASK}}
      />
    );
  } else {
    const name = glyphByKind[visual.kind] ?? 'forbid2Fill';
    glyph = (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          box,
          toneByVariant[visual.dot],
          (visual.kind === 'cancelled' || visual.kind === 'skipped') && 'opacity-70',
        )}
      >
        <Icon name={name} size={Math.round(size * (glyphScale[name] ?? 1))} />
      </span>
    );
  }

  const indicator = (
    <span role="img" aria-label={visual.label} className={cn('inline-flex shrink-0', className)}>
      {glyph}
    </span>
  );

  if (!tooltip) return indicator;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{indicator}</TooltipTrigger>
      <TooltipContent>{visual.label}</TooltipContent>
    </Tooltip>
  );
}
