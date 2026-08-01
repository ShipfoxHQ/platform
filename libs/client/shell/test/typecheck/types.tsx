import {getRouteApi, Link, useSearch} from '@tanstack/react-router';
import './shipfox-app.gen.js';

export function CompositionTypes(): React.ReactNode {
  const search = useSearch({from: '/w/$workspaceSlug/p/$projectSlug/overview'});
  const tab: 'activity' | 'overview' = search.tab;

  getRouteApi('/w/$workspaceSlug/p/$projectSlug/overview');

  // @ts-expect-error The generated route tree rejects unknown route ids.
  getRouteApi('/not-a-route');

  return (
    <>
      <Link to="/w/$workspaceSlug/insights" params={{workspaceSlug: 'workspace'}}>
        Insights
      </Link>
      <span>{tab}</span>
      {/* @ts-expect-error The generated route tree rejects unknown paths. */}
      <Link to="/not-a-route">Missing route</Link>
    </>
  );
}
