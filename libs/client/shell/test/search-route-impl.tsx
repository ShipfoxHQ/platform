import {defineRoute} from '@shipfox/client-shell/runtime';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => <div>Search route</div>,
  validateSearch: (search: Record<string, unknown>) =>
    ({tab: search.tab === 'activity' ? 'activity' : 'overview'}) as const,
});
