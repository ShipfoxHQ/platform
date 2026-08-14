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
import {type VariablePreview, workspaceStoreScope} from '#core/store.js';
import {useDeleteVariableMutation, useVariablesQuery} from '#hooks/api/variables.js';
import {copyKeyName} from './copy-key.js';
import {DeleteEntryDialog} from './delete-entry-dialog.js';
import {secretsErrorToFormError} from './form-errors.js';
import {StoreRowsSkeleton, StoreSurface} from './store-section-shell.js';
import {VariableForm} from './variable-form.js';

const VARIABLES_DESCRIPTION =
  'Plaintext configuration values for non-sensitive data like regions, flags, and log levels.';
const EMPTY_VARIABLES_DESCRIPTION =
  'Create a variable to store non-sensitive configuration like regions, flags, and log levels.';

type FormState = {mode: 'create'} | {mode: 'edit'; variable: VariablePreview} | null;

export function WorkspaceVariablesSection({workspaceId}: {workspaceId: string}) {
  const variablesQuery = useVariablesQuery(workspaceId);
  const deleteVariable = useDeleteVariableMutation();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const variables = useMemo(
    () => [...(variablesQuery.data ?? [])].sort((a, b) => a.key.localeCompare(b.key)),
    [variablesQuery.data],
  );

  function closeDelete() {
    setDeleteKey(null);
    setDeleteError(undefined);
  }

  return (
    <RelativeTimeProvider>
      <section className="flex flex-col gap-group" aria-label="Variables">
        <div className="flex items-start justify-between gap-group">
          <div className="flex flex-col gap-tight">
            <Header variant="h3">Variables</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              {VARIABLES_DESCRIPTION}
            </Text>
          </div>
          <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
            Create variable
          </Button>
        </div>

        {variablesQuery.isPending ? <StoreRowsSkeleton label="Loading variables" /> : null}

        {variablesQuery.isError && variablesQuery.data === undefined ? (
          <StoreSurface className="px-row">
            <QueryLoadError query={variablesQuery} subject="variables" />
          </StoreSurface>
        ) : null}

        {variablesQuery.data !== undefined && variables.length === 0 ? (
          <StoreSurface className="px-row">
            <EmptyState
              icon="bracesLine"
              title="No variables yet"
              description={EMPTY_VARIABLES_DESCRIPTION}
              action={
                <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
                  Create variable
                </Button>
              }
            />
          </StoreSurface>
        ) : null}

        {variables.length > 0 ? (
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
                {variables.map((variable) => (
                  <VariableRow
                    key={variable.key}
                    variable={variable}
                    onEdit={() => setFormState({mode: 'edit', variable})}
                    onDelete={() => setDeleteKey(variable.key)}
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
              {formState?.mode === 'edit' ? 'Update variable' : 'Create variable'}
            </ModalTitle>
          </ModalHeader>
          {formState ? (
            <VariableForm
              workspaceId={workspaceId}
              mode={formState.mode}
              existingKey={formState.mode === 'edit' ? formState.variable.key : undefined}
              existingValue={formState.mode === 'edit' ? formState.variable.value : undefined}
              existingValueTruncated={
                formState.mode === 'edit' ? formState.variable.valueTruncated : undefined
              }
              reservedKeys={variables.map((variable) => variable.key)}
              onSaved={() => {
                const wasEdit = formState.mode === 'edit';
                setFormState(null);
                toast.success(wasEdit ? 'Variable updated' : 'Variable created');
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
        isLoading={deleteVariable.isPending}
        errorMessage={deleteError}
        onConfirm={async () => {
          if (deleteKey === null) return;
          setDeleteError(undefined);
          try {
            await deleteVariable.mutateAsync({
              workspaceId,
              key: deleteKey,
              scope: workspaceStoreScope,
            });
            toast.success('Variable deleted');
            closeDelete();
          } catch (error) {
            setDeleteError(secretsErrorToFormError(error).message);
          }
        }}
      />
    </RelativeTimeProvider>
  );
}

function VariableRow({
  variable,
  onEdit,
  onDelete,
}: {
  variable: VariablePreview;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          className="inline-flex min-w-0 cursor-pointer rounded-4 border-none bg-transparent p-0 text-left text-foreground-neutral-base outline-none transition-colors hover:text-foreground-highlight-interactive focus-visible:shadow-border-interactive-with-active"
          aria-label={`Copy variable name ${variable.key}`}
          onClick={() => void copyKeyName(variable.key)}
        >
          <Code as="span" variant="paragraph" className="truncate">
            {variable.key}
          </Code>
        </button>
      </TableCell>
      <TableCell>
        <span
          title={variable.value}
          className="block max-w-[280px] truncate font-code text-foreground-neutral-base"
        >
          {variable.value === '' ? (
            <span className="text-foreground-neutral-muted">(empty)</span>
          ) : (
            variable.value
          )}
        </span>
      </TableCell>
      <TableCell className="text-foreground-neutral-muted">
        <RelativeTime value={variable.updatedAt} />
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Actions for ${variable.key}`}
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
