import {PanelCell, PanelCellAction} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';

export function AddCustomProviderCard({onConfigure}: {onConfigure: () => void}) {
  return (
    <PanelCell>
      <PanelCellAction
        action="Configure"
        aria-label="Configure custom provider"
        onClick={onConfigure}
      >
        <Text as="span" size="md" bold className="min-w-0 truncate">
          Custom
        </Text>
      </PanelCellAction>
    </PanelCell>
  );
}
