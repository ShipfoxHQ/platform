import {Panel, PanelBody, PanelCell, PanelGrid} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';

export function ModelProviderGridSkeleton({label}: {label: string}) {
  return (
    <Panel>
      <PanelBody>
        <PanelGrid role="status" aria-busy="true" aria-label={label}>
          {[0, 1, 2, 3].map((tile) => (
            <PanelCell key={tile}>
              <div className="flex items-center justify-between gap-cluster px-row py-row">
                <Skeleton className="h-16 w-100" />
                <Skeleton className="h-16 w-64 shrink-0" />
              </div>
            </PanelCell>
          ))}
        </PanelGrid>
      </PanelBody>
    </Panel>
  );
}
