import {Icon} from '@shipfox/react-ui/icon';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function AddCustomProviderCard({onConfigure}: {onConfigure: () => void}) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          'group block h-full w-full cursor-pointer p-panel-compact text-left outline-none transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus',
          SURFACE_CLASS,
        )}
        aria-label="Configure custom provider"
        onClick={onConfigure}
      >
        <div className="flex min-w-0 items-center justify-between gap-cluster">
          <Text size="md" bold className="min-w-0 truncate">
            Custom
          </Text>
          <div className="flex shrink-0 items-center gap-tight text-foreground-neutral-muted transition-colors group-hover:text-foreground-highlight-interactive">
            <Text size="sm">Configure</Text>
            <Icon name="chevronRight" className="size-16" />
          </div>
        </div>
      </button>
    </li>
  );
}
