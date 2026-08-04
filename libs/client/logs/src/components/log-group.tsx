'use client';

import {Icon} from '@shipfox/react-ui/icon';
import {LogDisclosure, LogDisclosureContent, LogDisclosureTrigger} from '@shipfox/react-ui/log';
import {cn, formatDuration} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import type {GroupLogNode} from '#core/log-tree.js';

export interface LogGroupProps {
  node: GroupLogNode;
  depth: number;
  terminated: boolean;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function LogGroup({node, depth, terminated, children, defaultOpen = false}: LogGroupProps) {
  const lineLabel = `${node.lineCount} ${node.lineCount === 1 ? 'line' : 'lines'}`;

  return (
    <LogDisclosure indent={depth} defaultOpen={defaultOpen}>
      <LogDisclosureTrigger
        summary={lineLabel}
        trailing={<GroupStatus node={node} terminated={terminated} />}
        className={cn(node.hasError && 'shadow-[inset_2px_0_0_var(--color-red-500)]')}
      >
        {node.record.name}
      </LogDisclosureTrigger>
      <LogDisclosureContent rail={false}>{children}</LogDisclosureContent>
    </LogDisclosure>
  );
}

function GroupStatus({node, terminated}: {node: GroupLogNode; terminated: boolean}): ReactNode {
  if (node.closed && node.endTs != null) {
    return (
      <span className="font-code tabular-nums">{formatDuration(node.endTs - node.record.ts)}</span>
    );
  }

  // No clean end: either still open under a terminated stream (runner died mid-group), or
  // closed only because an ancestor's group_end cascaded (its own end was dropped, so endTs
  // is null). Either way show "incomplete" rather than a blank slot or a forever spinner.
  if (node.closed || terminated) {
    return <span className="text-foreground-neutral-muted">incomplete</span>;
  }

  return (
    <span className="inline-flex items-center gap-tight text-foreground-neutral-muted">
      <Icon name="loader4Line" className="size-12 motion-safe:animate-spin" aria-hidden="true" />
      running
    </span>
  );
}
