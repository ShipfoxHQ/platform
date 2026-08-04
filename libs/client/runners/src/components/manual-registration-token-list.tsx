import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
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
import {type ManualRegistrationToken, tokenDisplayName} from '#core/token.js';
import {useRevokeManualRegistrationTokenMutation} from '#hooks/api/manual-registration-tokens.js';
import {manualRegistrationTokenErrorMessage} from './manual-registration-token-errors.js';
import {
  formatManualRegistrationTokenDate,
  formatManualRegistrationTokenTimestamp,
} from './manual-registration-token-format.js';
import {TokenDate} from './token-date.js';
import {TokenName} from './token-name.js';

export function ManualRegistrationTokenList({
  workspaceId,
  tokens,
}: {
  workspaceId: string;
  tokens: ManualRegistrationToken[];
}) {
  return (
    <>
      <div className="max-[760px]:hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[34%]">Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead className="w-128">Expires</TableHead>
              <TableHead className="w-128">Created</TableHead>
              <TableHead className="w-80 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token) => (
              <TableRow key={token.id}>
                <TableCell>
                  <TokenName name={tokenDisplayName(token)} />
                </TableCell>
                <TableCell>
                  <Code variant="paragraph" className="block truncate">
                    {token.prefix}
                  </Code>
                </TableCell>
                <TableCell>
                  <ManualRegistrationTokenDate value={token.expiresAt} />
                </TableCell>
                <TableCell>
                  <ManualRegistrationTokenDate value={token.createdAt} />
                </TableCell>
                <TableCell className="text-right">
                  <RevokeManualRegistrationTokenButton workspaceId={workspaceId} token={token} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul
        className="hidden flex-col gap-inline max-[760px]:flex"
        aria-label="Manual registration tokens"
      >
        {tokens.map((token) => (
          <li
            key={token.id}
            className="flex flex-col gap-cluster rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact"
          >
            <div className="flex items-start justify-between gap-cluster">
              <div className="min-w-0 flex-1">
                <TokenName name={tokenDisplayName(token)} />
                <Code variant="paragraph" className="block truncate text-foreground-neutral-muted">
                  {token.prefix}
                </Code>
              </div>
              <RevokeManualRegistrationTokenButton workspaceId={workspaceId} token={token} />
            </div>
            <dl className="grid grid-cols-2 gap-inline text-sm">
              <div>
                <dt className="text-foreground-neutral-muted">Expires</dt>
                <dd>
                  <ManualRegistrationTokenDate value={token.expiresAt} />
                </dd>
              </div>
              <div>
                <dt className="text-foreground-neutral-muted">Created</dt>
                <dd>
                  <ManualRegistrationTokenDate value={token.createdAt} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function ManualRegistrationTokenDate({value}: {value: string | null}) {
  return (
    <TokenDate
      value={value}
      date={formatManualRegistrationTokenDate(value)}
      timestamp={formatManualRegistrationTokenTimestamp(value)}
    />
  );
}

function RevokeManualRegistrationTokenButton({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: ManualRegistrationToken;
}) {
  const revokeToken = useRevokeManualRegistrationTokenMutation(workspaceId);
  const [open, setOpen] = useState(false);
  const tokenName = tokenDisplayName(token);

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
            aria-label={`Open ${tokenName} registration token actions`}
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
              {tokenName} will stop creating new runner sessions. Existing sessions and job leases
              expire on their own.
            </Text>
            {revokeToken.isError ? (
              <Callout role="alert" type="error">
                <Text size="sm">{manualRegistrationTokenErrorMessage(revokeToken.error)}</Text>
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

export function EmptyManualRegistrationTokens() {
  return (
    <EmptyState
      icon="key2Line"
      title="No usable manual registration tokens"
      description="Create a token to connect a runner to this workspace."
    />
  );
}

export function ManualRegistrationTokenTableSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading manual registration tokens"
      className="flex flex-col gap-inline"
    >
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-44 w-full" />
      ))}
    </div>
  );
}
