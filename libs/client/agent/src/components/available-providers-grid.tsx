import {Button} from '@shipfox/react-ui/button';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Input} from '@shipfox/react-ui/input';
import {Panel, PanelBody, PanelGrid, PanelHeader} from '@shipfox/react-ui/panel';
import type {ReactNode} from 'react';
import {useMemo, useRef, useState} from 'react';
import type {SupportedProvider} from '#core/models.js';
import {providerMatchesSearch} from '#core/provider-policy.js';
import {AvailableProviderCard} from './available-provider-card.js';

const SEARCH_VISIBILITY_THRESHOLD = 8;
const MAX_ECHOED_QUERY_LENGTH = 40;

export function AvailableProvidersGrid<TEntry extends SupportedProvider>({
  entries,
  onSelect,
  trailingCard,
  trailingCardMatchesSearch = () => true,
}: {
  entries: TEntry[];
  onSelect: (entry: TEntry) => void;
  trailingCard?: ReactNode | undefined;
  trailingCardMatchesSearch?: ((query: string) => boolean) | undefined;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedSearch = search.trim();
  const filteredEntries = useMemo(
    () => entries.filter((entry) => providerMatchesSearch(entry, search)),
    [entries, search],
  );
  const trailingCardVisible = trailingCard !== undefined && trailingCardMatchesSearch(search);
  const visibleCount = filteredEntries.length + (trailingCardVisible ? 1 : 0);
  const showSearch = entries.length > SEARCH_VISIBILITY_THRESHOLD || trimmedSearch !== '';
  const providerListLabel =
    trimmedSearch !== '' ? 'Available providers matching search' : 'Available providers';
  const resultCountText =
    trimmedSearch === '' ? '' : providerResultCountText(filteredEntries.length, trimmedSearch);

  function clearSearch() {
    setSearch('');
    inputRef.current?.focus();
  }

  return (
    <>
      <Panel>
        {showSearch ? (
          <PanelHeader>
            <Input
              ref={inputRef}
              type="search"
              aria-label="Search providers"
              placeholder="Search providers..."
              value={search}
              iconLeft={
                <Icon name="searchLine" className="size-16 text-foreground-neutral-muted" />
              }
              onChange={(event) => setSearch(event.target.value)}
            />
          </PanelHeader>
        ) : null}

        <PanelBody>
          {visibleCount > 0 ? (
            <PanelGrid aria-label={providerListLabel}>
              {filteredEntries.map((entry) => (
                <AvailableProviderCard
                  key={entry.id}
                  entry={entry}
                  onConfigure={() => onSelect(entry)}
                />
              ))}
              {trailingCardVisible ? trailingCard : null}
            </PanelGrid>
          ) : (
            <NoProviderSearchResults search={trimmedSearch} onClear={clearSearch} />
          )}
        </PanelBody>
      </Panel>

      <p role="status" aria-live="polite" className="sr-only">
        {resultCountText}
      </p>
    </>
  );
}

function NoProviderSearchResults({search, onClear}: {search: string; onClear: () => void}) {
  return (
    <EmptyState
      icon="searchLine"
      title={`No providers match "${truncateQuery(search)}"`}
      description="Try a different search, or clear it to see all providers."
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

function truncateQuery(query: string): string {
  if (query.length <= MAX_ECHOED_QUERY_LENGTH) return query;
  return `${query.slice(0, MAX_ECHOED_QUERY_LENGTH - 3)}...`;
}

function providerResultCountText(count: number, query: string): string {
  if (count === 1) return `1 provider matches "${query}"`;
  return `${count} providers match "${query}"`;
}
