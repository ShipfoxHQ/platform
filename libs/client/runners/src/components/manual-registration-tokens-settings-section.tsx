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
import {Header, Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import type {CreatedManualRegistrationToken} from '#core/token.js';
import {useManualRegistrationTokensQuery} from '#hooks/api/manual-registration-tokens.js';
import {
  CreatedManualRegistrationTokenPanel,
  CreateManualRegistrationTokenForm,
} from './create-manual-registration-token-form.js';
import {
  EmptyManualRegistrationTokens,
  ManualRegistrationTokenList,
  ManualRegistrationTokenTableSkeleton,
} from './manual-registration-token-list.js';

export function WorkspaceManualRegistrationTokensSettingsSection({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const tokensQuery = useManualRegistrationTokensQuery(workspaceId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedManualRegistrationToken | null>(null);
  const tokens = tokensQuery.data ?? [];

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
            <Header variant="h3">Runner registration tokens</Header>
          </div>
          <div className="flex items-center gap-cluster">
            {tokensQuery.isFetching && !tokensQuery.isPending ? (
              <Icon
                name="loader4Line"
                className="mt-[2px] size-18 text-foreground-neutral-muted"
                aria-label="Refreshing tokens"
              />
            ) : null}
            <Modal open={isModalOpen} onOpenChange={handleOpenChange}>
              <ModalTrigger asChild>
                <Button>Create token</Button>
              </ModalTrigger>
              <ModalContent aria-describedby={undefined}>
                <ModalTitle className="sr-only">Create manual registration token</ModalTitle>
                <ModalHeader>
                  <Text
                    size="lg"
                    aria-hidden="true"
                    className="overflow-ellipsis overflow-hidden whitespace-nowrap"
                  >
                    Create manual registration token
                  </Text>
                </ModalHeader>
                {createdToken ? (
                  <ModalBody className="gap-group">
                    <CreatedManualRegistrationTokenPanel token={createdToken} />
                  </ModalBody>
                ) : (
                  <CreateManualRegistrationTokenForm
                    workspaceId={workspaceId}
                    onCreated={setCreatedToken}
                  />
                )}
              </ModalContent>
            </Modal>
          </div>
        </div>

        {tokensQuery.isPending ? <ManualRegistrationTokenTableSkeleton /> : null}

        {tokensQuery.isError && tokensQuery.data === undefined ? (
          <Panel>
            <QueryLoadError
              query={tokensQuery}
              subject="manual registration tokens"
              variant="panel"
            />
          </Panel>
        ) : null}

        {tokensQuery.data !== undefined && tokens.length === 0 ? (
          <Panel>
            <EmptyManualRegistrationTokens />
          </Panel>
        ) : null}

        {tokens.length > 0 ? (
          <ManualRegistrationTokenList workspaceId={workspaceId} tokens={tokens} />
        ) : null}
      </section>
    </div>
  );
}
