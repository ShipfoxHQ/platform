import {PanelCell, PanelCellAction} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import type {SupportedProvider} from '#core/models.js';

export function AvailableProviderCard({
  entry,
  onConfigure,
}: {
  entry: SupportedProvider;
  onConfigure: () => void;
}) {
  return (
    <PanelCell>
      <PanelCellAction
        action="Configure"
        aria-label={`Configure ${entry.label}`}
        onClick={onConfigure}
      >
        <Text as="span" size="md" bold className="min-w-0 truncate">
          {entry.label}
        </Text>
      </PanelCellAction>
    </PanelCell>
  );
}
