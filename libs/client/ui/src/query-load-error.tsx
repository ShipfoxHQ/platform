import type {IconName} from '@shipfox/react-ui/icon';
import {LoadErrorState} from '@shipfox/react-ui/load-error-state';
import {loadErrorCopy} from './load-error-copy.js';

/**
 * Minimal shape of a React Query result this component reads. Typed structurally
 * so client-ui stays decoupled from react-query's generics: any `UseQueryResult`
 * is assignable. `data` is `undefined` only until the first successful fetch, which
 * is exactly the "errored with nothing loaded" signal we gate on.
 */
export interface QueryLoadErrorQuery {
  isError: boolean;
  isFetching: boolean;
  data: unknown;
  error: unknown;
  refetch: () => unknown;
}

export interface QueryLoadErrorProps {
  query: QueryLoadErrorQuery;
  /** Lowercase noun for the resource, e.g. "integrations". Drives copy + aria. */
  subject: string;
  icon?: IconName;
}

/**
 * Renders the calm load-error placeholder ONLY when the query failed and no data
 * was ever loaded. When stale data is present (a refetch failed after a prior
 * success) it renders nothing, so the caller keeps showing that data instead of
 * wiping it. Returns null otherwise.
 */
export function QueryLoadError({query, subject, icon}: QueryLoadErrorProps) {
  if (!query.isError || query.data !== undefined) return null;

  const copy = loadErrorCopy(query.error, {subject});

  return (
    <LoadErrorState
      {...(icon ? {icon} : {})}
      title={copy.title}
      description={copy.message}
      onRetry={() => {
        void query.refetch();
      }}
      retrying={query.isFetching}
      retryLabel={`Retry loading ${subject}`}
    />
  );
}
