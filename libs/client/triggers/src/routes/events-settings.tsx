import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {getRouteApi} from '@tanstack/react-router';
import type {TriggerEventFilters} from '#core/trigger-event.js';
import {EventsPage} from '#pages/events-page.js';
import {type TriggerEventsSearch, validateTriggerEventsSearch} from '#search.js';

const routeApi = getRouteApi('/w/$workspaceSlug/settings/events');

// Wrapped (not just re-typed) so the search validator's own type is portable outside this
// package: TanStack Router's `const` generics capture the exact declared function, and a
// route module consumed from another package (apps/client's composed router) can't print a
// type that only resolves through this package's internal `#search.js` path.
function validateSearch(search: Record<string, unknown>): TriggerEventsSearch {
  return validateTriggerEventsSearch(search);
}

export default defineRoute({
  staticData: {frame: 'content'},
  validateSearch,
  component: () => {
    const workspace = useActiveWorkspace();
    const search = routeApi.useSearch();
    const navigate = routeApi.useNavigate();
    const onFiltersChange = (patch: Partial<TriggerEventFilters>) => {
      void navigate({search: {...search, ...patch}, replace: true});
    };
    return (
      <EventsPage
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        filters={search}
        onFiltersChange={onFiltersChange}
      />
    );
  },
});
