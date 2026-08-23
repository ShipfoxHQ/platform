import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@shipfox/react-ui/modal';
import {Panel} from '@shipfox/react-ui/panel';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useMemo, useState} from 'react';
import type {CreatedProvisionerToken} from '#core/token.js';
import {
  useActiveProvisionersQuery,
  useProvisionerTokensQuery,
} from '#hooks/api/provisioner-tokens.js';
import {
  CreatedProvisionerTokenPanel,
  CreateProvisionerTokenForm,
} from './create-provisioner-token-form.js';
import {
  EmptyProvisionerTokens,
  ProvisionerTokenList,
  ProvisionerTokenTableSkeleton,
} from './provisioner-token-list.js';

export function WorkspaceProvisionerTokensSettingsSection({workspaceId}: {workspaceId: string}) {
  const tokensQuery = useProvisionerTokensQuery(workspaceId);
  const activeProvisionersQuery = useActiveProvisionersQuery(workspaceId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedProvisionerToken | null>(null);
  const tokens = tokensQuery.data ?? [];
  const activeIds = useMemo(
    () => new Set(activeProvisionersQuery.data?.provisioners.map((provisioner) => provisioner.id)),
    [activeProvisionersQuery.data],
  );

  function handleOpenChange(nextOpen: boolean) {
    setIsModalOpen(nextOpen);
    if (!nextOpen) {
      setCreatedToken(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-region">
      <section className="flex flex-col gap-group">
        <div className="flex items-center justify-between gap-group max-[640px]:items-start">
          <div className="flex flex-col gap-tight">
            <Header variant="h3">Runner provisioner registration tokens</Header>
          </div>
          <div className="flex items-center gap-cluster">
            {(tokensQuery.isFetching && !tokensQuery.isPending) ||
            (activeProvisionersQuery.isFetching && !activeProvisionersQuery.isPending) ? (
              <Icon
                name="loader4Line"
                className="mt-[2px] size-18 text-foreground-neutral-muted"
                aria-label="Refreshing provisioner tokens"
              />
            ) : null}
            <Modal open={isModalOpen} onOpenChange={handleOpenChange}>
              <ModalTrigger asChild>
                <Button>Create token</Button>
              </ModalTrigger>
              <ModalContent aria-describedby={undefined}>
                <ModalTitle className="sr-only">Create provisioner registration token</ModalTitle>
                <ModalHeader>
                  <Text
                    size="lg"
                    aria-hidden="true"
                    className="overflow-ellipsis overflow-hidden whitespace-nowrap"
                  >
                    Create provisioner registration token
                  </Text>
                </ModalHeader>
                {createdToken ? (
                  <ModalBody className="gap-group">
                    <CreatedProvisionerTokenPanel token={createdToken} />
                  </ModalBody>
                ) : (
                  <CreateProvisionerTokenForm
                    workspaceId={workspaceId}
                    onCreated={setCreatedToken}
                  />
                )}
              </ModalContent>
            </Modal>
          </div>
        </div>

        {tokensQuery.isPending ? <ProvisionerTokenTableSkeleton /> : null}

        {tokensQuery.isError && tokensQuery.data === undefined ? (
          <Panel>
            <QueryLoadError
              query={tokensQuery}
              subject="provisioner registration tokens"
              variant="panel"
            />
          </Panel>
        ) : null}

        {tokensQuery.data !== undefined && tokens.length === 0 ? (
          <Panel>
            <EmptyProvisionerTokens />
          </Panel>
        ) : null}

        {tokens.length > 0 ? (
          <RelativeTimeProvider>
            <ProvisionerTokenList workspaceId={workspaceId} tokens={tokens} activeIds={activeIds} />
          </RelativeTimeProvider>
        ) : null}
      </section>
    </div>
  );
}
