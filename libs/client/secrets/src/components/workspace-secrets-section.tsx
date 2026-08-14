import {QueryLoadError} from '@shipfox/client-ui';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Modal, ModalContent, ModalHeader, ModalTitle} from '@shipfox/react-ui/modal';
import {Panel} from '@shipfox/react-ui/panel';
import {RelativeTime, RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {useMemo, useState} from 'react';
import {type SecretMetadata, workspaceStoreScope} from '#core/store.js';
import {useDeleteSecretMutation, useSecretsQuery} from '#hooks/api/secrets.js';
import {copyKeyName} from './copy-key.js';
import {DeleteEntryDialog} from './delete-entry-dialog.js';
import {secretsErrorToFormError} from './form-errors.js';
import {SecretForm} from './secret-form.js';
import {StoreRowsSkeleton, StoreSurface} from './store-section-shell.js';

const SECRETS_DESCRIPTION =
  'Encrypted, write-only values for sensitive data like API keys, tokens, and passwords.';
const EMPTY_SECRETS_DESCRIPTION =
  'Create a secret to store sensitive values like API keys, tokens, and passwords.';

type FormState = {mode: 'create'} | {mode: 'edit'; key: string} | null;

export function WorkspaceSecretsSection({workspaceId}: {workspaceId: string}) {
  const secretsQuery = useSecretsQuery(workspaceId);
  const deleteSecret = useDeleteSecretMutation();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const secrets = useMemo(
    () => [...(secretsQuery.data ?? [])].sort((a, b) => a.key.localeCompare(b.key)),
    [secretsQuery.data],
  );

  function closeDelete() {
    setDeleteKey(null);
    setDeleteError(undefined);
  }

  return (
    <RelativeTimeProvider>
      <section className="flex flex-col gap-group" aria-label="Secrets">
        <div className="flex items-start justify-between gap-group">
          <div className="flex flex-col gap-tight">
            <Header variant="h3">Secrets</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              {SECRETS_DESCRIPTION}
            </Text>
          </div>
          <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
            Create secret
          </Button>
        </div>

        {secretsQuery.isPending ? <StoreRowsSkeleton label="Loading secrets" /> : null}

        {secretsQuery.isError && secretsQuery.data === undefined ? (
          <StoreSurface className="px-row">
            <QueryLoadError query={secretsQuery} subject="secrets" />
          </StoreSurface>
        ) : null}

        {secretsQuery.data !== undefined && secrets.length === 0 ? (
          <StoreSurface className="px-row">
            <EmptyState
              icon="keyLine"
              title="No secrets yet"
              description={EMPTY_SECRETS_DESCRIPTION}
              action={
                <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
                  Create secret
                </Button>
              }
            />
          </StoreSurface>
        ) : null}

        {secrets.length > 0 ? (
          <Panel>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Last edited</TableHead>
                  <TableHead className="w-40 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((secret) => (
                  <SecretRow
                    key={secret.key}
                    secret={secret}
                    onEdit={() => setFormState({mode: 'edit', key: secret.key})}
                    onDelete={() => setDeleteKey(secret.key)}
                  />
                ))}
              </TableBody>
            </Table>
          </Panel>
        ) : null}
      </section>

      <Modal
        open={formState !== null}
        onOpenChange={(open) => {
          if (!open) setFormState(null);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {formState?.mode === 'edit' ? 'Update secret' : 'Create secret'}
            </ModalTitle>
          </ModalHeader>
          {formState ? (
            <SecretForm
              workspaceId={workspaceId}
              mode={formState.mode}
              existingKey={formState.mode === 'edit' ? formState.key : undefined}
              reservedKeys={secrets.map((secret) => secret.key)}
              onSaved={() => {
                const wasEdit = formState.mode === 'edit';
                setFormState(null);
                toast.success(wasEdit ? 'Secret updated' : 'Secret created');
              }}
              onCancel={() => setFormState(null)}
            />
          ) : null}
        </ModalContent>
      </Modal>

      <DeleteEntryDialog
        open={deleteKey !== null}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
        entryKey={deleteKey ?? ''}
        isLoading={deleteSecret.isPending}
        errorMessage={deleteError}
        onConfirm={async () => {
          if (deleteKey === null) return;
          setDeleteError(undefined);
          try {
            await deleteSecret.mutateAsync({
              workspaceId,
              key: deleteKey,
              scope: workspaceStoreScope,
            });
            toast.success('Secret deleted');
            closeDelete();
          } catch (error) {
            setDeleteError(secretsErrorToFormError(error).message);
          }
        }}
      />
    </RelativeTimeProvider>
  );
}

function SecretRow({
  secret,
  onEdit,
  onDelete,
}: {
  secret: SecretMetadata;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          className="inline-flex min-w-0 cursor-pointer rounded-4 border-none bg-transparent p-0 text-left text-foreground-neutral-base outline-none transition-colors hover:text-foreground-highlight-interactive focus-visible:shadow-border-interactive-with-active"
          aria-label={`Copy secret name ${secret.key}`}
          onClick={() => void copyKeyName(secret.key)}
        >
          <Code as="span" variant="paragraph" className="truncate">
            {secret.key}
          </Code>
        </button>
      </TableCell>
      <TableCell>
        <span
          role="img"
          aria-label="Value hidden"
          className="font-code text-foreground-neutral-muted"
        >
          ••••••••
        </span>
      </TableCell>
      <TableCell className="text-foreground-neutral-muted">
        <RelativeTime value={secret.updatedAt} />
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Actions for ${secret.key}`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon="editLine" onSelect={onEdit}>
              Edit value
            </DropdownMenuItem>
            <DropdownMenuItem icon="deleteBinLine" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
