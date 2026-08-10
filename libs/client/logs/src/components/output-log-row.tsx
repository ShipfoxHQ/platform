import {LogContent, LogRow} from '@shipfox/react-ui/log';
import {cn} from '@shipfox/react-ui/utils';
import {type OutputLogRecord, stripTrailingNewline} from '#core/log-tree.js';

export interface OutputLogRowProps {
  record: OutputLogRecord;
  lineNumber?: number | null;
  indent?: number;
  selected?: boolean;
}

export function OutputLogRow({
  record,
  lineNumber = null,
  indent = 0,
  selected = false,
}: OutputLogRowProps) {
  const isStderr = record.stream === 'stderr';
  // Stderr uses a neutral channel rule; it is a stream, not a severity, so it never reads as an error.

  return (
    <LogRow
      lineNumber={lineNumber}
      timestamp={new Date(record.ts)}
      indent={indent}
      selected={selected}
      data-stream={record.stream}
      className={cn(isStderr && 'shadow-[inset_2px_0_0_var(--color-border-neutral-strong)]')}
    >
      <LogContent
        variant="code"
        ansi
        className={cn(isStderr && 'text-foreground-contrast-secondary')}
      >
        {stripTrailingNewline(record.data)}
      </LogContent>
    </LogRow>
  );
}
