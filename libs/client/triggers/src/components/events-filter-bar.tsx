import {Button} from '@shipfox/react-ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@shipfox/react-ui/collapsible';
import {Combobox, type ComboboxOption} from '@shipfox/react-ui/combobox';
import {type DateRange, DateRangePicker} from '@shipfox/react-ui/date-range-picker';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {type ReactNode, useState} from 'react';
import {
  type TriggerEventFacetItem,
  type TriggerEventFilters,
  type TriggerEventOutcome,
  type TriggerEventResultKind,
  triggerEventResultFilterOutcomes,
} from '#core/trigger-event.js';

// Filters expose the same plain-language results shown in the table. `failed`
// includes `errored` so the Failed filter does not hide rows rendered as failed.
const RESULT_FILTERS: {
  value: TriggerEventResultKind;
  selects: readonly TriggerEventOutcome[];
  label: string;
}[] = [
  {value: 'triggered', selects: triggerEventResultFilterOutcomes.triggered, label: 'Triggered'},
  {value: 'no-match', selects: triggerEventResultFilterOutcomes['no-match'], label: 'No match'},
  {value: 'failed', selects: triggerEventResultFilterOutcomes.failed, label: 'Failed'},
  {value: 'evaluating', selects: triggerEventResultFilterOutcomes.evaluating, label: 'Evaluating'},
];

const RESULT_OPTIONS: ComboboxOption[] = RESULT_FILTERS.map(({value, label}) => ({value, label}));

function toOptions(facets: TriggerEventFacetItem[] | undefined): ComboboxOption[] {
  return (facets ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} (${facet.count})`,
  }));
}

interface EventsFilterBarProps {
  filters: TriggerEventFilters;
  onFiltersChange: (patch: Partial<TriggerEventFilters>) => void;
  sources: TriggerEventFacetItem[] | undefined;
  events: TriggerEventFacetItem[] | undefined;
  hasActiveFilters: boolean;
  onClear: () => void;
}

export function EventsFilterBar({
  filters,
  onFiltersChange,
  sources,
  events,
  hasActiveFilters,
  onClear,
}: EventsFilterBarProps) {
  const [open, setOpen] = useState(false);

  const dateRange: DateRange | undefined =
    filters.from || filters.to
      ? {
          start: filters.from ? new Date(filters.from) : undefined,
          end: filters.to ? new Date(filters.to) : undefined,
        }
      : undefined;

  const selectedOutcomes = new Set(filters.outcome ?? []);
  const resultValue = RESULT_FILTERS.filter(({selects}) =>
    selects.some((outcome) => selectedOutcomes.has(outcome)),
  ).map(({value}) => value);

  // Count active dimensions, not selected options, so the badge stays stable as chips grow.
  const activeCount =
    (dateRange ? 1 : 0) +
    (filters.source?.length ? 1 : 0) +
    (filters.event?.length ? 1 : 0) +
    (resultValue.length > 0 ? 1 : 0);

  function handleResultValue(values: string[]) {
    const next = RESULT_FILTERS.filter(({value}) => values.includes(value)).flatMap(
      ({selects}) => selects,
    );
    onFiltersChange({outcome: next.length > 0 ? next : undefined});
  }

  function handleDateRange(range: DateRange | undefined) {
    const from = range?.start ? new Date(range.start).toISOString() : undefined;
    let to: string | undefined;
    if (range?.end) {
      // The backend filters received_at <= to; extend to end-of-day so the picked end
      // date is inclusive rather than cutting off at its midnight.
      const end = new Date(range.end);
      end.setHours(23, 59, 59, 999);
      to = end.toISOString();
    }
    onFiltersChange({from, to});
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-inline border-b border-border-neutral-base px-row py-row">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconLeft="filter3Line"
            iconRight={open ? 'arrowUpSLine' : 'arrowDownSLine'}
          >
            {activeCount > 0 ? `Filters (${activeCount})` : 'Filters'}
          </Button>
        </CollapsibleTrigger>
        {hasActiveFilters ? (
          <Button type="button" size="2xs" variant="transparentMuted" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className="grid grid-cols-1 gap-x-cluster gap-y-inline border-b border-border-neutral-base px-row py-row min-[520px]:grid-cols-2">
          <FilterField label="Date" className="col-span-full">
            <DateRangePicker
              size="small"
              className="w-full"
              {...(dateRange ? {dateRange} : {})}
              onDateRangeSelect={handleDateRange}
              onClear={() => onFiltersChange({from: undefined, to: undefined})}
              placeholder="Any date"
            />
          </FilterField>
          <FilterField label="Result">
            <Combobox
              multiple
              size="small"
              aria-label="Filter by result"
              options={RESULT_OPTIONS}
              value={resultValue}
              onValueChange={handleResultValue}
              placeholder="All results"
              emptyState="No results"
              className="w-full"
              maxVisibleChips={2}
            />
          </FilterField>
          <FilterField label="Source">
            <Combobox
              multiple
              size="small"
              options={toOptions(sources)}
              value={filters.source ?? []}
              onValueChange={(value) =>
                onFiltersChange({source: value.length > 0 ? value : undefined})
              }
              placeholder="All sources"
              emptyState="No sources yet"
              className="w-full"
              maxVisibleChips={2}
            />
          </FilterField>
          <FilterField label="Event">
            <Combobox
              multiple
              size="small"
              options={toOptions(events)}
              value={filters.event ?? []}
              onValueChange={(value) =>
                onFiltersChange({event: value.length > 0 ? value : undefined})
              }
              placeholder="All events"
              emptyState="No events yet"
              className="w-full"
              maxVisibleChips={2}
            />
          </FilterField>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FilterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-tight', className)}>
      <Text size="xs" className="font-medium text-foreground-neutral-muted">
        {label}
      </Text>
      {children}
    </div>
  );
}
