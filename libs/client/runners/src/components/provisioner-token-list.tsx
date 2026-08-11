import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Dot} from '@shipfox/react-ui/dot';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Panel} from '@shipfox/react-ui/panel';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import {
  type ProvisionerToken,
  provisionerConnectionStatus,
  provisionerTokenDisplayName,
} from '#core/token.js';
import {useRevokeProvisionerTokenMutation} from '#hooks/api/provisioner-tokens.js';
import {provisionerTokenErrorMessage} from './provisioner-token-errors.js';
import {
  formatProvisionerTokenDate,
  formatProvisionerTokenTimestamp,
} from './provisioner-token-format.js';
import {TokenDate} from './token-date.js';
import {TokenName} from './token-name.js';

export function ProvisionerTokenList({
  workspaceId,
  tokens,
  activeIds,
}: {
  workspaceId: string;
  tokens: ProvisionerToken[];
  activeIds: ReadonlySet<string>;
}) {
  return (
    <Panel>
      <div className="max-[760px]:hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28%]">Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead className="w-[18%]">Status</TableHead>
              <TableHead className="w-112">Expires</TableHead>
              <TableHead className="w-112">Created</TableHead>
              <TableHead className="w-80 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token) => (
              <TableRow key={token.id}>
                <TableCell>
                  <TokenName name={provisionerTokenDisplayName(token)} />
                </TableCell>
                <TableCell>
                  <Code variant="paragraph" className="block truncate">
                    {token.prefix}
                  </Code>
                </TableCell>
                <TableCell>
                  <ProvisionerStatusCell token={token} activeIds={activeIds} />
                </TableCell>
                <TableCell>
                  <ProvisionerTokenDate value={token.expiresAt} />
                </TableCell>
                <TableCell>
                  <ProvisionerTokenDate value={token.createdAt} />
                </TableCell>
                <TableCell className="text-right">
                  <RevokeProvisionerTokenButton workspaceId={workspaceId} token={token} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul
        className="hidden flex-col divide-y divide-border-neutral-base max-[760px]:flex"
        aria-label="Provisioner tokens"
      >
        {tokens.map((token) => (
          <li key={token.id} className="flex flex-col gap-cluster p-panel-compact">
            <div className="flex items-start justify-between gap-cluster">
              <div className="min-w-0 flex-1">
                <TokenName name={provisionerTokenDisplayName(token)} />
                <Code variant="paragraph" className="block truncate text-foreground-neutral-muted">
                  {token.prefix}
                </Code>
              </div>
              <RevokeProvisionerTokenButton workspaceId={workspaceId} token={token} />
            </div>
            <dl className="grid grid-cols-2 gap-inline text-sm">
              <div>
                <dt className="text-foreground-neutral-muted">Status</dt>
                <dd>
                  <ProvisionerStatusCell token={token} activeIds={activeIds} />
                </dd>
              </div>
              <div>
                <dt className="text-foreground-neutral-muted">Expires</dt>
                <dd>
                  <ProvisionerTokenDate value={token.expiresAt} />
                </dd>
              </div>
              <div>
                <dt className="text-foreground-neutral-muted">Created</dt>
                <dd>
                  <ProvisionerTokenDate value={token.createdAt} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ProvisionerTokenDate({value}: {value: string | null}) {
  return (
    <TokenDate
      value={value}
      date={formatProvisionerTokenDate(value)}
      timestamp={formatProvisionerTokenTimestamp(value)}
    />
  );
}

function ProvisionerStatusCell({
  token,
  activeIds,
}: {
  token: ProvisionerToken;
  activeIds: ReadonlySet<string>;
}) {
  const status = provisionerConnectionStatus(token, activeIds);

  return (
    <span className="inline-flex items-center gap-inline">
      <Dot variant={status.dotVariant} />
      {status.kind === 'last-seen' ? (
        <span>
          {status.label} <RelativeTime value={status.lastSeenAt} />
        </span>
      ) : (
        <span>{status.label}</span>
      )}
    </span>
  );
}

function RevokeProvisionerTokenButton({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: ProvisionerToken;
}) {
  const revokeToken = useRevokeProvisionerTokenMutation(workspaceId);
  const [open, setOpen] = useState(false);
  const tokenName = provisionerTokenDisplayName(token);

  async function handleRevoke() {
    try {
      await revokeToken.mutateAsync(token.id);
      setOpen(false);
    } catch {
      // React Query stores the error for the inline modal alert.
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      revokeToken.reset();
    }
  }

  function openRevokeConfirmation() {
    revokeToken.reset();
    setOpen(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            type="button"
            size="sm"
            variant="transparent"
            icon="more2Line"
            aria-label={`Open ${tokenName} token actions`}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" size="sm">
          <DropdownMenuItem onSelect={openRevokeConfirmation}>Revoke token</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Modal open={open} onOpenChange={handleOpenChange}>
        <ModalContent aria-describedby={undefined} className="max-w-[420px]">
          <ModalTitle className="sr-only">Revoke token</ModalTitle>
          <ModalHeader title="Revoke token?" />
          <ModalBody className="gap-group">
            <Text size="sm" className="text-foreground-neutral-muted">
              {tokenName} will stop authenticating this provisioner. Runners it already provisioned
              keep running until their leases expire.
            </Text>
            {revokeToken.isError ? (
              <Callout role="alert" type="error">
                <Text size="sm">{provisionerTokenErrorMessage(revokeToken.error)}</Text>
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
              isLoading={revokeToken.isPending}
              onClick={handleRevoke}
            >
              Revoke
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export function EmptyProvisionerTokens() {
  return (
    <EmptyState
      icon="key2Line"
      title="No usable provisioner registration tokens"
      description="Create a token to connect a provisioner that provisions runners on demand."
      variant="panel"
    />
  );
}

export function ProvisionerTokenTableSkeleton() {
  return (
    <Panel role="status" aria-label="Loading provisioner tokens" className="divide-y">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-44 w-full rounded-none" />
      ))}
    </Panel>
  );
}
