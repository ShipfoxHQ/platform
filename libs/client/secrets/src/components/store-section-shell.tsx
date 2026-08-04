import {Skeleton} from '@shipfox/react-ui/skeleton';
import {cn} from '@shipfox/react-ui/utils';

export const STORE_SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

/** Placeholder rows shown while the store list loads. */
export function StoreRowsSkeleton({label}: {label: string}) {
  return (
    <div role="status" aria-label={label} className={STORE_SURFACE_CLASS}>
      <ul className="divide-y divide-border-neutral-base">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex items-center gap-cluster px-row py-row">
            <Skeleton className="h-16 w-140" />
            <Skeleton className="h-16 w-96" />
            <Skeleton className="ml-auto h-14 w-80 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StoreSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn(STORE_SURFACE_CLASS, className)}>{children}</div>;
}
