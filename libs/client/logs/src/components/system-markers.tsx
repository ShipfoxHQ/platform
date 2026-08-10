import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {LogContent, LogRow} from '@shipfox/react-ui/log';
import {cn, formatBytes, formatDuration} from '@shipfox/react-ui/utils';
import type {
  CappedLogRecord,
  EndLogRecord,
  GapLogRecord,
  RunnerLostLogRecord,
} from '#core/log-tree.js';

type MarkerTone = 'default' | 'warning' | 'error';

const toneText: Record<MarkerTone, string> = {
  default: 'text-foreground-contrast-secondary',
  warning: 'text-foreground-contrast-primary',
  error: 'text-foreground-contrast-primary',
};

const toneIcon: Record<MarkerTone, string> = {
  default: 'text-foreground-contrast-secondary',
  warning: 'text-tag-warning-icon',
  error: 'text-tag-error-icon',
};

interface LogMarkerRowProps {
  icon: IconName;
  tone: MarkerTone;
  timestamp?: Date | null;
  /** Plain-language clause after the label: what it means / what to do. */
  detail?: string;
  /** Right-aligned `font-code` figures (bytes, line count, duration). */
  meta?: string;
  terminalFailure?: boolean;
  children: string;
}

/**
 * Shared timeline-marker row: a non-numbered line with a leading icon, a bold label, an
 * optional plain-language detail clause, a dashed divider, and optional right-aligned
 * monospace figures. The detail explains the consequence to the operator (the label
 * names the event, the icon/tone carry severity), so the copy reads helpfully rather
 * than mechanically.
 */
function LogMarkerRow({
  icon,
  tone,
  timestamp = null,
  detail,
  meta,
  terminalFailure = false,
  children,
}: LogMarkerRowProps) {
  return (
    <LogRow
      lineNumber={null}
      timestamp={timestamp}
      tone={tone}
      data-log-terminal-failure={terminalFailure ? 'true' : undefined}
    >
      <LogContent className={cn('block', toneText[tone])}>
        <span className="inline-flex w-full items-center gap-inline">
          <Icon
            name={icon}
            className={cn('size-14 flex-none', toneIcon[tone])}
            aria-hidden="true"
          />
          {/* Label, detail, and figures share one text cluster joined by a literal
              " · ". Flex `gap` is visual only and would copy with no separator, so the
              separators are real inline text. The dashed rule trails after the text
              (an aria-hidden flex filler) and contributes nothing to a selection. */}
          <span className="min-w-0">
            <span className="font-medium">{children}</span>
            {detail != null && (
              <>
                {' · '}
                <span className="font-normal opacity-80">{detail}</span>
              </>
            )}
            {meta != null && (
              <>
                {' · '}
                <span className="font-code tabular-nums opacity-80">{meta}</span>
              </>
            )}
          </span>
          <span
            aria-hidden="true"
            className="h-px flex-1 border-t border-dashed border-current opacity-30"
          />
        </span>
      </LogContent>
    </LogRow>
  );
}

export interface EndMarkerProps {
  record: EndLogRecord;
  lineCount: number;
  durationMs?: number | null;
}

/** Clean end of the log: line count + output bytes (+ overall duration). `total_bytes` is payload bytes. */
export function EndMarker({record, lineCount, durationMs = null}: EndMarkerProps) {
  const meta = [
    `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`,
    formatBytes(record.totalBytes),
    ...(durationMs != null ? [formatDuration(durationMs)] : []),
  ].join(' · ');

  return (
    <LogMarkerRow icon="flagLine" tone="default" timestamp={new Date(record.ts)} meta={meta}>
      End of log
    </LogMarkerRow>
  );
}

/** The runner's local backlog shed bytes before upload, so some output never arrived. A warning. */
export function GapMarker({record}: {record: GapLogRecord}) {
  return (
    <LogMarkerRow
      icon="errorWarningLine"
      tone="warning"
      timestamp={new Date(record.ts)}
      detail={`the runner fell behind and dropped ${formatBytes(record.droppedBytes)}`}
    >
      Output missing
    </LogMarkerRow>
  );
}

/** The job hit its shared log size limit; logging stopped but the step kept running. A warning. */
export function CappedMarker({record}: {record: CappedLogRecord}) {
  return (
    <LogMarkerRow
      icon="forbidLine"
      tone="warning"
      timestamp={new Date(record.ts)}
      detail="later output isn't shown; the step kept running"
    >
      Log size limit reached
    </LogMarkerRow>
  );
}

/** The runner disappeared and the stream was force-closed. A terminal failure (status taxonomy §9). */
export function RunnerLostMarker({record}: {record: RunnerLostLogRecord}) {
  return (
    <LogMarkerRow
      icon="closeCircleLine"
      tone="error"
      timestamp={new Date(record.ts)}
      detail="the log ends here and may be incomplete"
      terminalFailure
    >
      Runner disconnected
    </LogMarkerRow>
  );
}
