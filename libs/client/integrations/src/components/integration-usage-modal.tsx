import {Button} from '@shipfox/react-ui/button';
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
} from '@shipfox/react-ui/code-block';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipfox/react-ui/select';
import {Text} from '@shipfox/react-ui/typography';
import type {ReactNode} from 'react';
import {useEffect, useMemo, useState} from 'react';
import {ConnectionStatusBadge} from '#connection-status-badge.js';
import type {IntegrationConnection} from '#core/models.js';

export interface IntegrationUsageEvent {
  value: string;
  label: string;
}

interface IntegrationUsageModalProps {
  connection: IntegrationConnection | null;
  events: IntegrationUsageEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}

const WORKFLOW_FILENAME = '.shipfox/workflows/integration.yml';

export function IntegrationUsageModal({
  connection,
  events,
  open,
  onOpenChange,
  children,
}: IntegrationUsageModalProps) {
  const [selectedEvent, setSelectedEvent] = useState('');
  const eventValuesKey = events.map((event) => event.value).join('\u0000');

  useEffect(() => {
    const eventValues = eventValuesKey ? eventValuesKey.split('\u0000') : [];
    setSelectedEvent((current) =>
      eventValues.includes(current) ? current : (eventValues[0] ?? ''),
    );
  }, [eventValuesKey]);

  const workflowExample = connection
    ? buildWorkflowExample({source: connection.slug, event: selectedEvent})
    : '';
  const data = useMemo(
    () => [{language: 'yaml', filename: WORKFLOW_FILENAME, code: workflowExample}],
    [workflowExample],
  );
  const title = connection ? `Use ${connection.displayName}` : 'Use integration';

  if (!open || connection === null) return null;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent aria-describedby={undefined} className="max-h-[calc(100vh-32px)] max-w-[640px]">
        <ModalTitle className="sr-only">{title}</ModalTitle>
        <ModalHeader>
          <div className="flex min-w-0 flex-col gap-tight">
            <div className="flex min-w-0 items-center gap-inline">
              <Text size="lg" aria-hidden="true" className="truncate">
                {title}
              </Text>
              {connection ? (
                <ConnectionStatusBadge status={connection.lifecycleStatus} className="shrink-0" />
              ) : null}
            </div>
            <Text size="sm" className="text-foreground-neutral-muted">
              Reference this connection from a workflow trigger.
            </Text>
          </div>
        </ModalHeader>
        {connection ? (
          <>
            <ModalBody className="min-h-0 flex-1 gap-section overflow-y-auto overflow-x-clip scrollbar">
              <section className="flex w-full flex-col gap-cluster">
                <Text size="md" bold>
                  Usage
                </Text>
                {events.length > 1 ? (
                  <div className="flex flex-col gap-inline">
                    <label
                      htmlFor="integration-usage-event"
                      className="font-display text-sm font-medium text-foreground-neutral-base"
                    >
                      Event
                    </label>
                    <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                      <SelectTrigger id="integration-usage-event">
                        <SelectValue placeholder="Select event" />
                      </SelectTrigger>
                      <SelectContent>
                        {events.map((event) => (
                          <SelectItem key={event.value} value={event.value}>
                            {event.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <CodeBlock data={data} className="h-auto min-h-0 rounded-8">
                  <CodeBlockHeader>
                    <CodeBlockFiles>
                      {(item) => (
                        <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>
                      )}
                    </CodeBlockFiles>
                    <CodeBlockCopyButton />
                  </CodeBlockHeader>
                  <CodeBlockBody>
                    {(item) => (
                      <CodeBlockItem value={item.filename}>
                        <CodeBlockContent
                          language="yaml"
                          syntaxHighlighting
                          highlightedLineRange={{startLine: 3, endLine: 4}}
                        >
                          {item.code}
                        </CodeBlockContent>
                      </CodeBlockItem>
                    )}
                  </CodeBlockBody>
                </CodeBlock>
              </section>
              {children ? (
                <section className="flex w-full flex-col gap-cluster">
                  <Text size="md" bold>
                    Details
                  </Text>
                  {children}
                </section>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function buildWorkflowExample({source, event}: {source: string; event: string}) {
  return [
    'triggers:',
    '  integration:',
    `    source: ${source}`,
    `    event: ${event}`,
    'jobs:',
    '  handle-event:',
    '    steps:',
    '      - run: echo "Received event"',
  ].join('\n');
}
