import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@shipfox/react-ui/modal';
import {Panel} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import type {AgentGrant} from '#agent-access/core/agent-access.js';
import {
  useAgentGrantsQuery,
  useRevokeAgentGrantMutation,
} from '#hooks/api/agent-access/credentials.js';
import {agentAccessErrorMessage} from './errors.js';
import {formatAgentAccessDate, formatAgentAccessTimestamp} from './format.js';

export function AgentAccessSettingsPage({workspaceId}: {workspaceId: string}) {
  const grantsQuery = useAgentGrantsQuery();
  const grants = (grantsQuery.data ?? []).filter((grant) => grant.workspaceId === workspaceId);

  return (
    <section className="flex min-w-0 flex-col gap-group" aria-labelledby="connected-apps-title">
      <div className="flex flex-col gap-tight">
        <Header id="connected-apps-title" variant="h3">
          Connected apps
        </Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Tools connected to this workspace through MCP.
        </Text>
      </div>
      {grantsQuery.isPending ? <GrantListSkeleton /> : null}
      {grantsQuery.isError && grantsQuery.data === undefined ? (
        <Panel>
          <QueryLoadError query={grantsQuery} subject="connected apps" variant="panel" />
        </Panel>
      ) : null}
      {grantsQuery.data !== undefined && grants.length === 0 ? (
        <Panel>
          <EmptyState
            icon="terminalBoxLine"
            title="No connected apps"
            description="Apps you connect to this workspace through MCP will appear here."
            variant="panel"
          />
        </Panel>
      ) : null}
      {grants.length > 0 ? <AgentGrantList grants={grants} /> : null}
    </section>
  );
}

export function AgentGrantList({grants}: {grants: AgentGrant[]}) {
  return (
    <Panel>
      <div className="max-[760px]:hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead className="w-144">Connected</TableHead>
              <TableHead className="w-160">Access refreshed</TableHead>
              <TableHead className="w-128 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell className="truncate font-medium">{grant.clientName}</TableCell>
                <TableCell>
                  <CredentialDate value={grant.createdAt} />
                </TableCell>
                <TableCell>
                  <CredentialDate value={grant.lastRefreshedAt} />
                </TableCell>
                <TableCell className="text-right">
                  <RevokeGrantButton grant={grant} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul
        className="hidden flex-col divide-y divide-border-neutral-base max-[760px]:flex"
        aria-label="Connected apps"
      >
        {grants.map((grant) => (
          <li key={grant.id} className="flex flex-col gap-group p-panel-compact">
            <div className="min-w-0">
              <Text bold className="truncate">
                {grant.clientName}
              </Text>
              <Text size="sm" className="mt-tight text-foreground-neutral-muted">
                Connected <CredentialDate value={grant.createdAt} /> · Access refreshed{' '}
                <CredentialDate value={grant.lastRefreshedAt} />
              </Text>
            </div>
            <RevokeGrantButton grant={grant} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RevokeGrantButton({grant}: {grant: AgentGrant}) {
  const revoke = useRevokeAgentGrantMutation();
  const [open, setOpen] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) revoke.reset();
  }

  async function handleRevoke() {
    try {
      await revoke.mutateAsync(grant.id);
      setOpen(false);
    } catch {
      // React Query retains the failure for the inline alert.
    }
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="transparent"
          aria-label={`Disconnect ${grant.clientName}`}
        >
          Disconnect
        </Button>
      </ModalTrigger>
      <ModalContent aria-describedby={undefined} className="max-w-[420px]">
        <ModalTitle className="sr-only">Disconnect {grant.clientName}?</ModalTitle>
        <ModalHeader title={`Disconnect ${grant.clientName}?`} />
        <ModalBody className="gap-group">
          <Text bold className="break-words">
            {grant.clientName}
          </Text>
          <Text size="sm" className="text-foreground-neutral-muted">
            This app will no longer be able to refresh its access to Shipfox. Existing access may
            continue for up to 15 minutes.
          </Text>
          {revoke.error ? (
            <Callout type="error" role="alert">
              <Text size="sm">{agentAccessErrorMessage(revoke.error)}</Text>
            </Callout>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            isLoading={revoke.isPending}
            onClick={() => void handleRevoke()}
          >
            Disconnect app
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function CredentialDate({value}: {value: string | null}) {
  const timestamp = formatAgentAccessTimestamp(value);
  return timestamp ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help rounded-4 outline-none focus-visible:shadow-button-neutral-focus"
        >
          <time dateTime={value ?? undefined}>{formatAgentAccessDate(value)}</time>
        </button>
      </TooltipTrigger>
      <TooltipContent>{timestamp}</TooltipContent>
    </Tooltip>
  ) : (
    <>Never</>
  );
}

function GrantListSkeleton() {
  return (
    <Panel
      role="status"
      aria-label="Loading connected apps"
      className="divide-y divide-border-neutral-base"
    >
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-48 w-full rounded-none" />
      ))}
    </Panel>
  );
}
