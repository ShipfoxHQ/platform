import {Skeleton} from '@shipfox/react-ui/skeleton';
import {cn} from '@shipfox/react-ui/utils';
import {PROVIDER_GRID_CLASS} from './available-providers-grid.js';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function ModelProviderGridSkeleton({label}: {label: string}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={PROVIDER_GRID_CLASS}>
      {[0, 1, 2, 3].map((tile) => (
        <div
          key={tile}
          className={cn('flex h-136 w-full flex-col justify-center p-panel-compact', SURFACE_CLASS)}
        >
          <div className="flex items-center justify-between gap-cluster">
            <Skeleton className="h-16 w-100" />
            <Skeleton className="h-16 w-64 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
