'use client';

import {Icon} from '@shipfox/react-ui/icon';
import {
  LogContent,
  LogDisclosure,
  LogDisclosureContent,
  LogDisclosureTrigger,
  LogRow,
} from '@shipfox/react-ui/log';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {cn} from '@shipfox/react-ui/utils';
import {Fragment, useState} from 'react';
import type {SessionViewRow, SessionViewRowMeta} from '#core/log-model.js';

const PREVIEW_CHAR_LIMIT = 1200;
const WORD_SUMMARY_CHAR_LIMIT = 5000;
const WHITESPACE = /\s+/g;
const WORD_SEPARATOR = /\s+/;

export interface AgentSessionRowsProps {
  rows: readonly SessionViewRow[];
  resolvedToolCallIds: ReadonlySet<string>;
  toolCallNames: ReadonlyMap<string, string>;
  indent: number;
}

export function AgentSessionRows({
  rows,
  resolvedToolCallIds,
  toolCallNames,
  indent,
}: AgentSessionRowsProps) {
  return rows.map((row, index) => (
    <AgentSessionRowView
      // biome-ignore lint/suspicious/noArrayIndexKey: session rows are immutable and never reordered, so the index is stable; content keys would balloon to megabyte strings and collide on repeated id-less tool calls.
      key={`${row.kind}-${index}`}
      row={row}
      resolvedToolCallIds={resolvedToolCallIds}
      toolCallNames={toolCallNames}
      indent={indent}
    />
  ));
}

function AgentSessionRowView({
  row,
  resolvedToolCallIds,
  toolCallNames,
  indent,
}: {
  row: SessionViewRow;
  resolvedToolCallIds: ReadonlySet<string>;
  toolCallNames: ReadonlyMap<string, string>;
  indent: number;
}) {
  switch (row.kind) {
    case 'message':
      return (
        <LogRow
          lineNumber={null}
          timestamp={new Date(row.timestamp)}
          indent={indent}
          tone={row.terminalFailure ? 'error' : 'default'}
          data-log-terminal-failure={row.terminalFailure ? 'true' : undefined}
        >
          <LogContent className="text-foreground-contrast-primary">
            <span className="flex min-w-0 items-start gap-inline">
              <MessageIcon role={row.role} terminalFailure={row.terminalFailure} />
              <span className="flex min-w-0 flex-1 flex-col gap-tight">
                <span className="flex min-w-0 items-center gap-inline">
                  <MessageRoleLabel label={row.label} terminalFailure={row.terminalFailure} />
                  <RowMetadata meta={row.meta} className="ml-auto flex-none" />
                </span>
                <span className="block min-w-0">
                  <PreviewText text={row.text} />
                </span>
              </span>
            </span>
          </LogContent>
        </LogRow>
      );
    case 'thinking':
      return (
        <LogDisclosure indent={indent}>
          <LogDisclosureTrigger
            summary={wordSummary(row.text)}
            timestamp={new Date(row.timestamp)}
            className="text-foreground-contrast-secondary"
          >
            thinking
          </LogDisclosureTrigger>
          <LogDisclosureContent className="text-foreground-contrast-secondary">
            <LogContent className="text-foreground-contrast-secondary">
              <PreviewText text={row.text} />
            </LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      );
    case 'tool-call': {
      const awaitingResult = row.id != null && !resolvedToolCallIds.has(row.id);
      return (
        <LogDisclosure indent={indent}>
          <LogDisclosureTrigger
            timestamp={new Date(row.timestamp)}
            summary={compactPreview(row.summary ?? row.input)}
            trailing={
              awaitingResult ? (
                <span className="inline-flex items-center gap-tight">
                  <Icon
                    name="loader4Line"
                    className="size-12 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                  awaiting result
                </span>
              ) : null
            }
          >
            <span className="inline-flex min-w-0 items-center gap-inline">
              <Icon name="terminalBoxLine" className="size-14 flex-none" aria-hidden="true" />
              <span className="truncate">tool {row.name}</span>
            </span>
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            {row.summary != null ? (
              <>
                <LogContent>
                  <PreviewText text={row.summary} />
                </LogContent>
                <LogContent variant="code">
                  <PreviewText text={row.input} />
                </LogContent>
              </>
            ) : (
              <LogContent variant="code">
                <PreviewText text={row.input} />
              </LogContent>
            )}
          </LogDisclosureContent>
        </LogDisclosure>
      );
    }
    case 'tool-result': {
      const toolName =
        row.toolName === 'tool'
          ? ((row.toolCallId != null ? toolCallNames.get(row.toolCallId) : undefined) ??
            '(unmatched)')
          : row.toolName;
      return (
        <LogDisclosure indent={indent}>
          <LogDisclosureTrigger
            timestamp={new Date(row.timestamp)}
            summary={compactPreview(row.output)}
            trailing={
              <span
                className={cn(
                  'inline-flex items-center gap-tight',
                  row.isError ? 'text-tag-error-icon' : 'text-foreground-contrast-secondary',
                )}
              >
                <Icon
                  name={row.isError ? 'closeCircleLine' : 'checkLine'}
                  className="size-12"
                  aria-hidden="true"
                />
                {row.isError ? 'error' : 'ok'}
              </span>
            }
          >
            <span className="inline-flex min-w-0 items-center gap-inline">
              <Icon name="terminalWindowLine" className="size-14 flex-none" aria-hidden="true" />
              <span className="truncate">result {toolName}</span>
            </span>
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent variant="code" className="text-foreground-contrast-primary">
              <PreviewText text={row.output} />
            </LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      );
    }
    case 'lifecycle':
      return (
        <LogRow
          lineNumber={null}
          timestamp={new Date(row.timestamp)}
          indent={indent}
          tone={row.tone}
          data-log-terminal-failure={row.terminalFailure ? 'true' : undefined}
        >
          <LogContent className="text-foreground-contrast-secondary">
            <span className="inline-flex w-full items-center gap-inline">
              <Icon name="informationLine" className="size-14 flex-none" aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-medium">{row.label}</span>
                {row.detail != null ? (
                  <>
                    {' · '}
                    <span className="text-foreground-contrast-secondary">{row.detail}</span>
                  </>
                ) : null}
              </span>
              <span
                aria-hidden="true"
                className="h-px flex-1 border-t border-dashed border-current opacity-30"
              />
              <RowMetadata meta={row.meta} />
            </span>
          </LogContent>
        </LogRow>
      );
    case 'raw':
      return (
        <LogDisclosure indent={indent}>
          <LogDisclosureTrigger
            timestamp={new Date(row.timestamp)}
            summary={compactPreview(row.raw)}
            className="text-foreground-contrast-primary"
          >
            <span className="inline-flex min-w-0 items-center gap-inline">
              <Icon
                name="errorWarningLine"
                className="size-14 flex-none text-tag-warning-icon"
                aria-hidden="true"
              />
              <span className="truncate">{row.label}</span>
            </span>
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent variant="code">
              <PreviewText text={row.raw} />
            </LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      );
    default:
      return assertNever(row);
  }
}

function MessageIcon({role, terminalFailure}: {role: string; terminalFailure: boolean}) {
  const name = terminalFailure
    ? 'closeCircleLine'
    : role === 'user'
      ? 'userLine'
      : role === 'assistant'
        ? 'robot2Line'
        : 'message2Line';

  return (
    <Icon
      name={name}
      className={cn(
        'mt-[2px] size-14 flex-none',
        terminalFailure ? 'text-tag-error-icon' : 'text-foreground-contrast-secondary',
      )}
      aria-hidden="true"
    />
  );
}

function MessageRoleLabel({label, terminalFailure}: {label: string; terminalFailure: boolean}) {
  return (
    <span
      className={cn(
        'min-w-0 font-code text-foreground-contrast-secondary',
        terminalFailure && 'text-foreground-contrast-primary',
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function RowMetadata({meta, className}: {meta: readonly SessionViewRowMeta[]; className?: string}) {
  if (meta.length === 0) return null;

  const inlineMeta = meta.length === 1 && meta[0]?.inline !== false ? meta[0] : null;
  if (inlineMeta != null) {
    return (
      <span
        className={cn('font-code text-xs text-foreground-contrast-secondary', className)}
        title={`${inlineMeta.label}: ${inlineMeta.value}`}
      >
        {inlineMeta.value}
      </span>
    );
  }

  return (
    <span className={className}>
      <MetadataTrigger meta={meta} />
    </span>
  );
}

function MetadataTrigger({meta}: {meta: readonly SessionViewRowMeta[]}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-20 flex-none items-center justify-center rounded-4 text-foreground-contrast-secondary opacity-60 transition-opacity hover:bg-background-components-hover hover:text-foreground-contrast-primary hover:opacity-100 focus-visible:opacity-100 focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary-500)] group-hover/log-row:opacity-100"
          aria-label="Show message metadata"
        >
          <Icon name="informationLine" className="size-12" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent align="end" variant="inverted" className="max-w-360 p-tight">
        <span className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-[var(--space-inline)] gap-y-[var(--space-tight)] font-code text-xs">
          {meta.map((item) => (
            <Fragment key={`${item.label}-${item.value}`}>
              <span className="text-foreground-contrast-secondary">{item.label}</span>
              <span className="min-w-0 break-all text-foreground-contrast-primary">
                {item.value}
              </span>
            </Fragment>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function PreviewText({text}: {text: string}) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > PREVIEW_CHAR_LIMIT;
  const visible = truncated && !expanded ? `${text.slice(0, PREVIEW_CHAR_LIMIT)}…` : text;

  return (
    <>
      {visible}
      {truncated ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="ms-inline inline-flex min-h-24 items-center rounded-4 px-tight font-display text-xs text-foreground-highlight-interactive focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary-500)]"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      ) : null}
    </>
  );
}

function compactPreview(value: string): string {
  // Normalize only a bounded head: tool output can be megabytes, and this runs
  // per render for every disclosure trigger.
  const head = value.length > 200 ? value.slice(0, 200) : value;
  const singleLine = head.replace(WHITESPACE, ' ').trim();
  if (singleLine.length <= 80) return singleLine;
  return `${singleLine.slice(0, 80)}…`;
}

function wordSummary(value: string): string {
  const truncated = value.length > WORD_SUMMARY_CHAR_LIMIT;
  const head = truncated ? value.slice(0, WORD_SUMMARY_CHAR_LIMIT) : value;
  const count = head.trim().split(WORD_SEPARATOR).filter(Boolean).length;
  const marker = truncated ? '+' : '';
  return `${count}${marker} ${count === 1 ? 'word' : 'words'}`;
}

function assertNever(value: never): never {
  throw new Error(`unexpected agent session row: ${JSON.stringify(value)}`);
}
