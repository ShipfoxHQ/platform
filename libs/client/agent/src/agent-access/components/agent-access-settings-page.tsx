import {agentAccessNameSchema} from '@shipfox/api-auth-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Badge} from '@shipfox/react-ui/badge';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipfox/react-ui/select';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useEffect, useRef, useState} from 'react';
import type {
  AgentGrant,
  AgentPersonalAccessToken,
  AgentPersonalAccessTokenExpiration,
  CreatedAgentPersonalAccessToken,
} from '#agent-access/core/agent-access.js';
import {createAgentPersonalAccessTokenCommand} from '#agent-access/core/agent-access.js';
import {
  useAgentGrantsQuery,
  useAgentPersonalAccessTokensQuery,
  useCreateAgentPersonalAccessTokenMutation,
  useRevokeAgentGrantMutation,
  useRevokeAgentPersonalAccessTokenMutation,
} from '#hooks/api/agent-access/credentials.js';
import {agentAccessErrorMessage} from './errors.js';
import {formatAgentAccessDate, formatAgentAccessTimestamp} from './format.js';

export function AgentAccessSettingsPage({workspaceId}: {workspaceId: string}) {
  return (
    <div className="flex min-w-0 flex-col gap-region">
      <ConnectedAgentsSection workspaceId={workspaceId} />
      <PersonalAccessTokensSection workspaceId={workspaceId} />
    </div>
  );
}

function ConnectedAgentsSection({workspaceId}: {workspaceId: string}) {
  const grantsQuery = useAgentGrantsQuery();
  const grants = (grantsQuery.data ?? []).filter((grant) => grant.workspaceId === workspaceId);

  return (
    <section className="flex min-w-0 flex-col gap-group" aria-labelledby="connected-agents-title">
      <div className="flex flex-col gap-tight">
        <Header id="connected-agents-title" variant="h3">
          Connected agents
        </Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Apps you approved to read data from this workspace.
        </Text>
      </div>
      {grantsQuery.isPending ? <CredentialListSkeleton label="Loading connected agents" /> : null}
      {grantsQuery.isError && grantsQuery.data === undefined ? (
        <Panel>
          <QueryLoadError query={grantsQuery} subject="connected agents" variant="panel" />
        </Panel>
      ) : null}
      {grantsQuery.data !== undefined && grants.length === 0 ? (
        <Panel>
          <EmptyState
            icon="robot2Line"
            title="No connected agents"
            description="Approved OAuth clients for this workspace will appear here."
            variant="panel"
          />
        </Panel>
      ) : null}
      {grants.length > 0 ? <AgentGrantList grants={grants} /> : null}
    </section>
  );
}

function PersonalAccessTokensSection({workspaceId}: {workspaceId: string}) {
  const tokensQuery = useAgentPersonalAccessTokensQuery();
  const tokens = (tokensQuery.data ?? []).filter((token) => token.workspaceId === workspaceId);
  const createToken = useCreateAgentPersonalAccessTokenMutation(workspaceId);
  const [open, setOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedAgentPersonalAccessToken | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && createToken.isPending) return;
    setOpen(nextOpen);
    if (!nextOpen) setCreatedToken(null);
  }

  return (
    <section className="flex min-w-0 flex-col gap-group" aria-labelledby="personal-tokens-title">
      <div className="flex items-start justify-between gap-group max-[640px]:flex-col">
        <div className="flex flex-col gap-tight">
          <Header id="personal-tokens-title" variant="h3">
            Personal access tokens
          </Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Long-lived read-only credentials for scripts and local agents.
          </Text>
        </div>
        <Modal open={open} onOpenChange={handleOpenChange}>
          <ModalTrigger asChild>
            <Button>Create token</Button>
          </ModalTrigger>
          <ModalContent aria-describedby={undefined}>
            <ModalTitle className="sr-only">Create personal access token</ModalTitle>
            <ModalHeader
              title="Create personal access token"
              showEscIndicator={!createToken.isPending}
              showClose={!createToken.isPending}
            />
            {createdToken ? (
              <CreatedPersonalAccessToken
                token={createdToken}
                onDone={() => handleOpenChange(false)}
              />
            ) : (
              <CreatePersonalAccessTokenForm
                createToken={createToken}
                onCreated={setCreatedToken}
              />
            )}
          </ModalContent>
        </Modal>
      </div>
      {tokensQuery.isPending ? (
        <CredentialListSkeleton label="Loading personal access tokens" />
      ) : null}
      {tokensQuery.isError && tokensQuery.data === undefined ? (
        <Panel>
          <QueryLoadError query={tokensQuery} subject="personal access tokens" variant="panel" />
        </Panel>
      ) : null}
      {tokensQuery.data !== undefined && tokens.length === 0 ? (
        <Panel>
          <EmptyState
            icon="key2Line"
            title="No personal access tokens"
            description="Create a token for a script or agent you trust."
            variant="panel"
          />
        </Panel>
      ) : null}
      {tokens.length > 0 ? <PersonalAccessTokenList tokens={tokens} /> : null}
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
              <TableHead className="w-[34%]">Client</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="w-160">Last refreshed</TableHead>
              <TableHead className="w-96 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell className="truncate font-medium">{grant.clientName}</TableCell>
                <TableCell>
                  <Badge variant="info">Read-only</Badge>
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
        aria-label="Connected agents"
      >
        {grants.map((grant) => (
          <li key={grant.id} className="flex items-start justify-between gap-group p-panel-compact">
            <div className="min-w-0 flex-1">
              <Text bold className="truncate">
                {grant.clientName}
              </Text>
              <div className="mt-tight flex items-center gap-inline">
                <Badge variant="info">Read-only</Badge>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Last refreshed <CredentialDate value={grant.lastRefreshedAt} />
                </Text>
              </div>
            </div>
            <RevokeGrantButton grant={grant} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function PersonalAccessTokenList({tokens}: {tokens: AgentPersonalAccessToken[]}) {
  return (
    <Panel>
      <div className="max-[760px]:hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[32%]">Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead className="w-144">Expires</TableHead>
              <TableHead className="w-144">Last used</TableHead>
              <TableHead className="w-96 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token) => (
              <TableRow key={token.id}>
                <TableCell className="truncate font-medium">{token.name}</TableCell>
                <TableCell>
                  <Code variant="paragraph" className="block truncate">
                    {token.prefix}
                  </Code>
                </TableCell>
                <TableCell>
                  <CredentialDate value={token.expiresAt} />
                </TableCell>
                <TableCell>
                  <CredentialDate value={token.lastUsedAt} />
                </TableCell>
                <TableCell className="text-right">
                  <RevokePersonalAccessTokenButton token={token} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul
        className="hidden flex-col divide-y divide-border-neutral-base max-[760px]:flex"
        aria-label="Personal access tokens"
      >
        {tokens.map((token) => (
          <li key={token.id} className="flex items-start justify-between gap-group p-panel-compact">
            <div className="min-w-0 flex-1">
              <Text bold className="truncate">
                {token.name}
              </Text>
              <Code variant="paragraph" className="block truncate text-foreground-neutral-muted">
                {token.prefix}
              </Code>
              <Text size="sm" className="mt-tight text-foreground-neutral-muted">
                Expires <CredentialDate value={token.expiresAt} /> · Last used{' '}
                <CredentialDate value={token.lastUsedAt} />
              </Text>
            </div>
            <RevokePersonalAccessTokenButton token={token} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RevokeGrantButton({grant}: {grant: AgentGrant}) {
  const revoke = useRevokeAgentGrantMutation();
  return (
    <RevokeCredentialButton
      label={grant.clientName}
      title="Revoke agent access?"
      description={`${grant.clientName} will immediately lose access to this workspace. Existing access tokens can no longer be refreshed.`}
      pending={revoke.isPending}
      error={revoke.error}
      reset={revoke.reset}
      revoke={() => revoke.mutateAsync(grant.id)}
    />
  );
}

function RevokePersonalAccessTokenButton({token}: {token: AgentPersonalAccessToken}) {
  const revoke = useRevokeAgentPersonalAccessTokenMutation();
  return (
    <RevokeCredentialButton
      label={token.name}
      title="Revoke personal access token?"
      description={`${token.name} will stop working immediately. This action cannot be undone.`}
      pending={revoke.isPending}
      error={revoke.error}
      reset={revoke.reset}
      revoke={() => revoke.mutateAsync(token.id)}
    />
  );
}

function RevokeCredentialButton({
  label,
  title,
  description,
  pending,
  error,
  reset,
  revoke,
}: {
  label: string;
  title: string;
  description: string;
  pending: boolean;
  error: unknown;
  reset: () => void;
  revoke: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) reset();
  }

  async function handleRevoke() {
    try {
      await revoke();
      setOpen(false);
    } catch {
      // React Query retains the failure for the inline alert.
    }
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>
        <IconButton
          type="button"
          size="sm"
          variant="transparent"
          icon="deleteBinLine"
          aria-label={`Revoke ${label}`}
        />
      </ModalTrigger>
      <ModalContent aria-describedby={undefined} className="max-w-[420px]">
        <ModalTitle className="sr-only">{title}</ModalTitle>
        <ModalHeader title={title} />
        <ModalBody className="gap-group">
          <Text size="sm" className="text-foreground-neutral-muted">
            {description}
          </Text>
          {error ? (
            <Callout type="error" role="alert">
              <Text size="sm">{agentAccessErrorMessage(error)}</Text>
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
            isLoading={pending}
            onClick={() => void handleRevoke()}
          >
            Revoke
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

const CREATE_PAT_FORM_ID = 'create-agent-personal-access-token-form';

function CreatePersonalAccessTokenForm({
  createToken,
  onCreated,
}: {
  createToken: ReturnType<typeof useCreateAgentPersonalAccessTokenMutation>;
  onCreated: (token: CreatedAgentPersonalAccessToken) => void;
}) {
  const [formError, setFormError] = useState<string>();
  const form = useForm({
    defaultValues: {name: '', expiration: '90'},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const token = await createToken.mutateAsync(
          createAgentPersonalAccessTokenCommand(
            value.name,
            Number(value.expiration) as AgentPersonalAccessTokenExpiration,
          ),
        );
        onCreated(token);
      } catch (error) {
        setFormError(agentAccessErrorMessage(error));
      }
    },
  });

  return (
    <>
      <ModalBody className="gap-group">
        <form
          id={CREATE_PAT_FORM_ID}
          className="flex flex-col gap-group"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{
              onBlur: ({value}) => tokenNameValidationMessage(value),
              onSubmit: ({value}) => tokenNameValidationMessage(value),
            }}
          >
            {(field) => (
              <FormField
                label="Token name"
                id="agent-personal-access-token-name"
                error={fieldError(field)}
              >
                <FormFieldInput
                  autoFocus
                  placeholder="Local coding agent"
                  maxLength={256}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          </form.Field>
          <form.Field name="expiration">
            {(field) => (
              <FormField
                label="Expires"
                id="agent-personal-access-token-expiration"
                error={fieldError(field)}
              >
                <Select value={field.state.value} onValueChange={field.handleChange}>
                  <SelectTrigger id="agent-personal-access-token-expiration" className="w-full">
                    <SelectValue placeholder="Select expiration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </form.Field>
        </form>
        {formError ? (
          <Callout type="error" role="alert">
            <Text size="sm">{formError}</Text>
          </Callout>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button type="submit" form={CREATE_PAT_FORM_ID} isLoading={createToken.isPending}>
          Create token
        </Button>
      </ModalFooter>
    </>
  );
}

function tokenNameValidationMessage(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a token name.';
  return agentAccessNameSchema.safeParse(trimmed).success
    ? undefined
    : 'Use a name of 256 characters or fewer without hidden control characters.';
}

export function CreatedPersonalAccessToken({
  token,
  onDone,
}: {
  token: CreatedAgentPersonalAccessToken;
  onDone?: () => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function resetCopyStateAfter(delay: number) {
    if (copyStateTimeoutRef.current) clearTimeout(copyStateTimeoutRef.current);
    copyStateTimeoutRef.current = setTimeout(() => setCopyState('idle'), delay);
  }

  const {copy} = useCopyToClipboard({
    text: token.token,
    onCopy: () => {
      setCopyState('copied');
      resetCopyStateAfter(1500);
    },
  });

  useEffect(() => {
    return () => {
      if (copyStateTimeoutRef.current) clearTimeout(copyStateTimeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await copy();
    } catch {
      setCopyState('failed');
      resetCopyStateAfter(2500);
    }
  }

  return (
    <>
      <ModalBody className="gap-group">
        <Callout type="success" variant="secondary" icon={null}>
          <CalloutContent className="flex flex-col gap-cluster">
            <div className="flex flex-col gap-tight">
              <CalloutTitle className="mb-0">Token created</CalloutTitle>
              <CalloutDescription>
                Copy this personal access token now. It will not be shown again.
              </CalloutDescription>
            </div>
            <div className="flex items-center gap-inline max-[640px]:flex-col max-[640px]:items-stretch">
              <Code variant="paragraph" className="min-w-0 flex-1 break-all">
                {token.token}
              </Code>
              <Button
                size="sm"
                variant="secondary"
                iconLeft="fileCopyLine"
                onClick={() => void handleCopy()}
              >
                {copyState === 'copied' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {copyState === 'failed' ? (
              <Text size="sm" className="text-foreground-neutral-muted">
                Copy failed: select and copy manually.
              </Text>
            ) : null}
          </CalloutContent>
        </Callout>
      </ModalBody>
      {onDone ? (
        <ModalFooter>
          <Button onClick={onDone}>Done</Button>
        </ModalFooter>
      ) : null}
    </>
  );
}

function CredentialDate({value}: {value: string | null}) {
  const timestamp = formatAgentAccessTimestamp(value);
  return timestamp ? (
    <time dateTime={value ?? undefined} title={timestamp}>
      {formatAgentAccessDate(value)}
    </time>
  ) : (
    <>Never</>
  );
}

function CredentialListSkeleton({label}: {label: string}) {
  return (
    <Panel role="status" aria-label={label} className="divide-y divide-border-neutral-base">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-48 w-full rounded-none" />
      ))}
    </Panel>
  );
}
