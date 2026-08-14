import {Panel, PanelBody, PanelRow} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';

/** Placeholder rows shown while the store list loads. */
export function StoreRowsSkeleton({label}: {label: string}) {
  return (
    <Panel>
      <PanelBody asChild>
        <ul role="status" aria-label={label}>
          {[0, 1, 2].map((row) => (
            <PanelRow
              asChild
              className="justify-start gap-cluster hover:bg-background-neutral-base"
              key={row}
            >
              <li>
                <Skeleton className="h-16 w-140" />
                <Skeleton className="h-16 w-96" />
                <Skeleton className="ml-auto h-14 w-80 shrink-0" />
              </li>
            </PanelRow>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
