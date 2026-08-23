'use client';

import {ArrowRight, Search, Webhook, X} from 'lucide-react';
import Link from 'next/link';
import {useEffect, useMemo, useRef, useState} from 'react';
import {siGitea, siGithub, siJira, siLinear, siSentry, siSlack} from 'simple-icons';
import {captureDocsEvent} from '@/lib/docs-analytics';
import {nextCatalogSearchState, normalizeCatalogQuery} from '@/lib/docs-analytics-core';
import {
  type CatalogIcon,
  type CatalogProvider,
  catalogCapabilityLabels,
  catalogCategoryLabels,
  countFacetValues,
  emptyCatalogFilters,
  filterProviders,
  INTEGRATION_CATALOG_CAPABILITIES,
  INTEGRATION_CATALOG_CATEGORIES,
} from '@/lib/integration-catalog';
import {
  catalogFilterChangedProperties,
  catalogResultClickedProperties,
  catalogSearchProperties,
} from '@/lib/integration-catalog-analytics';

interface IntegrationCatalogProps {
  providers: CatalogProvider[];
}

export function IntegrationCatalog({providers}: IntegrationCatalogProps) {
  const [filters, setFilters] = useState(emptyCatalogFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const lastCapturedQuery = useRef<string | null>(null);
  const filteredProviders = useMemo(
    () => filterProviders(providers, filters),
    [filters, providers],
  );
  const facetCounts = useMemo(() => countFacetValues(providers, filters), [filters, providers]);
  const activeFilterCount = filters.capability.length + filters.category.length;
  const hasFilters = filters.query.length > 0 || activeFilterCount > 0;

  useEffect(() => {
    const query = normalizeCatalogQuery(filters.query);
    if (query.queryLength === 0) {
      lastCapturedQuery.current = null;
      return;
    }

    const timer = window.setTimeout(() => {
      const searchState = nextCatalogSearchState(lastCapturedQuery.current, query.dedupeKey);
      lastCapturedQuery.current = searchState.lastQuery;
      if (searchState.capture)
        captureDocsEvent(
          'docs_catalog_searched',
          catalogSearchProperties(filters, filteredProviders.length),
        );
    }, 750);

    return () => window.clearTimeout(timer);
  }, [filteredProviders.length, filters]);

  function clearFilters() {
    if (hasFilters)
      captureDocsEvent(
        'docs_catalog_filter_changed',
        catalogFilterChangedProperties(providers, emptyCatalogFilters, {
          facet: 'all',
          value: 'all',
          action: 'cleared',
        }),
      );
    setFilters(emptyCatalogFilters);
  }

  function toggleCapability(value: (typeof INTEGRATION_CATALOG_CAPABILITIES)[number]) {
    const isSelected = filters.capability.includes(value);
    const nextFilters = {
      ...filters,
      capability: toggleFilter(filters.capability, value),
    };
    setFilters(nextFilters);
    captureDocsEvent(
      'docs_catalog_filter_changed',
      catalogFilterChangedProperties(providers, nextFilters, {
        facet: 'capability',
        value,
        action: isSelected ? 'removed' : 'selected',
      }),
    );
  }

  function toggleCategory(value: (typeof INTEGRATION_CATALOG_CATEGORIES)[number]) {
    const isSelected = filters.category.includes(value);
    const nextFilters = {...filters, category: toggleFilter(filters.category, value)};
    setFilters(nextFilters);
    captureDocsEvent(
      'docs_catalog_filter_changed',
      catalogFilterChangedProperties(providers, nextFilters, {
        facet: 'category',
        value,
        action: isSelected ? 'removed' : 'selected',
      }),
    );
  }

  function removeCapability(value: (typeof INTEGRATION_CATALOG_CAPABILITIES)[number]) {
    const nextFilters = {...filters, capability: removeFilter(filters.capability, value)};
    setFilters(nextFilters);
    captureDocsEvent(
      'docs_catalog_filter_changed',
      catalogFilterChangedProperties(providers, nextFilters, {
        facet: 'capability',
        value,
        action: 'removed',
      }),
    );
  }

  function removeCategory(value: (typeof INTEGRATION_CATALOG_CATEGORIES)[number]) {
    const nextFilters = {...filters, category: removeFilter(filters.category, value)};
    setFilters(nextFilters);
    captureDocsEvent(
      'docs_catalog_filter_changed',
      catalogFilterChangedProperties(providers, nextFilters, {
        facet: 'category',
        value,
        action: 'removed',
      }),
    );
  }

  return (
    <section
      aria-label="Integration catalog"
      className="not-prose my-region grid gap-region lg:grid-cols-[minmax(0,1fr)_240px]"
    >
      <div className="flex flex-col gap-group lg:col-start-1">
        <label htmlFor="integration-catalog-search" className="sr-only">
          Search integrations
        </label>
        <div className="flex min-h-11 items-center gap-tight rounded-md border border-fd-border bg-fd-background px-row py-row outline-none focus-within:ring-2 focus-within:ring-fd-ring">
          <Search
            aria-hidden="true"
            className="pointer-events-none size-4 shrink-0 text-fd-muted-foreground"
          />
          <input
            id="integration-catalog-search"
            type="search"
            value={filters.query}
            data-ph-no-autocapture=""
            onChange={(event) => setFilters((current) => ({...current, query: event.target.value}))}
            placeholder="Search by provider, type, or related term"
            className="min-w-0 flex-1 bg-transparent text-sm text-fd-foreground outline-none placeholder:text-fd-muted-foreground"
          />
          {filters.query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setFilters((current) => ({...current, query: ''}))}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          aria-controls="integration-catalog-filters"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
          className="min-h-11 w-full rounded-md border border-fd-border p-tight text-sm font-medium text-fd-foreground outline-none hover:bg-fd-muted focus-visible:ring-2 focus-visible:ring-fd-ring lg:hidden"
        >
          {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
        </button>
      </div>

      <aside
        id="integration-catalog-filters"
        aria-label="Filter integrations"
        className={`${filtersOpen ? 'block' : 'hidden'} flex flex-col gap-section border-t border-fd-border p-panel-compact lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:!flex lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pb-0 lg:pr-0 lg:pt-0 lg:px-frame`}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-fd-foreground">Filters</p>
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              Clear all
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-section">
          <FacetGroup
            label="What it does"
            values={INTEGRATION_CATALOG_CAPABILITIES}
            selected={filters.capability}
            labels={catalogCapabilityLabels}
            counts={facetCounts.capability}
            onToggle={toggleCapability}
          />
          <FacetGroup
            label="Type"
            values={INTEGRATION_CATALOG_CATEGORIES}
            selected={filters.category}
            labels={catalogCategoryLabels}
            counts={facetCounts.category}
            onToggle={toggleCategory}
          />
        </div>
      </aside>

      <div className="flex flex-col gap-section lg:col-start-1">
        <div className="flex flex-col gap-cluster">
          <p aria-live="polite" className="text-sm text-fd-muted-foreground">
            {filteredProviders.length}{' '}
            {filteredProviders.length === 1 ? 'integration' : 'integrations'} found
          </p>
          {activeFilterCount > 0 ? (
            <div className="flex flex-wrap gap-inline">
              {filters.capability.map((capability) => (
                <FilterChip
                  key={capability}
                  label={catalogCapabilityLabels[capability]}
                  onRemove={() => removeCapability(capability)}
                />
              ))}
              {filters.category.map((category) => (
                <FilterChip
                  key={category}
                  label={catalogCategoryLabels[category]}
                  onRemove={() => removeCategory(category)}
                />
              ))}
            </div>
          ) : null}
        </div>

        {filteredProviders.length === 0 ? (
          <div className="flex flex-col items-center gap-group rounded-lg border border-dashed border-fd-border p-panel text-center">
            <div className="flex flex-col items-center gap-inline">
              <p className="text-sm font-medium text-fd-foreground">
                No integrations match these filters
              </p>
              <p className="text-sm text-fd-muted-foreground">
                Try another term or remove a filter.
              </p>
            </div>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="min-h-11 rounded-md p-tight text-sm font-medium text-fd-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-fd-border border-y border-fd-border">
            {filteredProviders.map((provider) => (
              <IntegrationDirectoryItem
                key={provider.slug}
                provider={provider}
                onNavigate={(target) =>
                  captureDocsEvent(
                    'docs_catalog_result_clicked',
                    catalogResultClickedProperties(filters, filteredProviders, provider, target),
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface FacetGroupProps<Value extends string> {
  label: string;
  values: readonly Value[];
  selected: readonly Value[];
  labels: Record<Value, string>;
  counts: Record<Value, number>;
  onToggle: (value: Value) => void;
}

function FacetGroup<Value extends string>({
  label,
  values,
  selected,
  labels,
  counts,
  onToggle,
}: FacetGroupProps<Value>) {
  return (
    <fieldset className="flex flex-col gap-inline">
      <legend className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
        {label}
      </legend>
      <div>
        {values.map((value) => {
          const count = counts[value];
          const optionLabel = labels[value];
          const isSelected = selected.includes(value);

          return (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-inline p-tight text-sm ${
                count === 0 ? 'text-fd-muted-foreground' : 'text-fd-foreground'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(value)}
                aria-label={`${optionLabel}, ${count} results`}
                className="size-4 shrink-0 rounded border-fd-border accent-fd-primary focus-visible:ring-2 focus-visible:ring-fd-ring"
              />
              <span>{optionLabel}</span>
              <span className="ml-auto tabular-nums text-xs text-fd-muted-foreground">{count}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function FilterChip({label, onRemove}: {label: string; onRemove: () => void}) {
  return (
    <span className="inline-flex items-center gap-tight rounded-full border border-fd-border bg-fd-muted p-tight text-xs text-fd-foreground">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );
}

function IntegrationDirectoryItem({
  provider,
  onNavigate,
}: {
  provider: CatalogProvider;
  onNavigate: (target: 'overview' | 'setup') => void;
}) {
  const details = [
    provider.capabilities.includes('source_control') && 'Code checkout',
    provider.eventCount > 0 &&
      `${provider.eventCount} ${provider.eventCount === 1 ? 'event' : 'events'}`,
    provider.toolCount > 0 &&
      `${provider.toolCount} ${provider.toolCount === 1 ? 'agent tool' : 'agent tools'}`,
  ].filter(Boolean);

  return (
    <li className="flex min-w-0 items-center gap-group py-row">
      <Link
        href={provider.overviewHref}
        onClick={() => onNavigate('overview')}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-cluster rounded-md text-fd-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
      >
        <ProviderIcon icon={provider.icon} />
        <span className="flex min-w-0 flex-col gap-tight">
          <span className="font-semibold">{provider.name}</span>
          <span className="text-xs leading-4 text-fd-muted-foreground">{details.join(' · ')}</span>
        </span>
      </Link>
      {provider.setupHref ? (
        <Link
          href={provider.setupHref}
          onClick={() => onNavigate('setup')}
          className="inline-flex min-h-11 shrink-0 items-center gap-tight rounded-md px-tight text-sm font-medium text-fd-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring"
        >
          Set up
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
    </li>
  );
}

function toggleFilter<Value>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function removeFilter<Value>(values: readonly Value[], value: Value): Value[] {
  return values.filter((item) => item !== value);
}

function ProviderIcon({icon}: {icon: CatalogIcon}) {
  if (icon === 'webhooks')
    return <Webhook aria-hidden="true" className="size-5 shrink-0 text-fd-muted-foreground" />;

  const brandIcon = {
    github: siGithub,
    gitea: siGitea,
    jira: siJira,
    sentry: siSentry,
    linear: siLinear,
    slack: siSlack,
  }[icon];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 fill-current text-fd-muted-foreground"
    >
      <path d={brandIcon.path} />
    </svg>
  );
}
