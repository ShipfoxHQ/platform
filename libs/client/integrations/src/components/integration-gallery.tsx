import {useActiveWorkspace} from '@shipfox/client-auth';
import type {IntegrationCapability} from '#core/models.js';
import {IntegrationGalleryForWorkspace} from './integration-gallery-for-workspace.js';

export interface IntegrationGalleryProps {
  capability?: IntegrationCapability;
  emptyProvidersMessage?: string;
  workspaceId?: string;
}

export function IntegrationGallery({
  capability,
  emptyProvidersMessage = 'Enable at least one provider in the application settings.',
  workspaceId,
}: IntegrationGalleryProps) {
  if (workspaceId) {
    return (
      <IntegrationGalleryForWorkspace
        workspaceId={workspaceId}
        capability={capability}
        emptyProvidersMessage={emptyProvidersMessage}
      />
    );
  }

  return (
    <RoutedIntegrationGallery
      capability={capability}
      emptyProvidersMessage={emptyProvidersMessage}
    />
  );
}

function RoutedIntegrationGallery({
  capability,
  emptyProvidersMessage,
}: {
  capability: IntegrationCapability | undefined;
  emptyProvidersMessage: string;
}) {
  const workspace = useActiveWorkspace();
  return (
    <IntegrationGalleryForWorkspace
      workspaceId={workspace.id}
      capability={capability}
      emptyProvidersMessage={emptyProvidersMessage}
    />
  );
}
