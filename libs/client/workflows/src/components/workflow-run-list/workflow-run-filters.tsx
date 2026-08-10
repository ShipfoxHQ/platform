import {Button} from '@shipfox/react-ui/button';
import {DateRangePicker} from '@shipfox/react-ui/date-range-picker';
import {Icon} from '@shipfox/react-ui/icon';
import {Input} from '@shipfox/react-ui/input';
import {Label} from '@shipfox/react-ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shipfox/react-ui/sheet';
import {useState} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {
  WORKFLOW_RUN_LIST_STATUSES,
  type WorkflowRunFilterPatch,
  type WorkflowRunListStatus,
  type WorkflowRunsSearch,
} from '#routes/inputs.js';
import type {WorkflowRunFacets} from './run-display.js';
import {WorkflowRunFilterMenu, type WorkflowRunFilterOption} from './workflow-run-filter-menu.js';

const STATUS_OPTIONS: WorkflowRunFilterOption[] = WORKFLOW_RUN_LIST_STATUSES.map((status) => ({
  value: status,
  label: getWorkflowStatusVisual(status).label,
}));

export interface WorkflowRunFiltersProps {
  search: WorkflowRunsSearch;
  facets: WorkflowRunFacets;
  onChange: (patch: WorkflowRunFilterPatch) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}

/**
 * The run list filter row.
 *
 * Inline from `md` up, and behind a sheet below it, where a five-control toolbar would eat
 * the viewport the list is supposed to fill. Both layouts render the same controls, so the
 * narrow surface is the full filter set rather than a reduced one.
 */
export function WorkflowRunFilters({
  search,
  facets,
  onChange,
  onClear,
  hasActiveFilters,
}: WorkflowRunFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex w-full flex-wrap items-center gap-inline">
      <Input
        value={search.search ?? ''}
        onChange={(event) => onChange({search: event.target.value})}
        placeholder="Search runs by name, number, branch, or commit"
        aria-label="Search runs"
        size="small"
        className="min-w-[240px] flex-1"
        iconLeft={<Icon name="searchLine" className="size-14 text-foreground-neutral-muted" />}
      />

      <div className="hidden flex-wrap items-center gap-inline md:flex">
        <WorkflowRunFilterControls search={search} facets={facets} onChange={onChange} />
        {hasActiveFilters ? <ClearFiltersButton onClear={onClear} /> : null}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconLeft="filterLine"
            className="md:hidden"
          >
            Filters
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>Filter runs</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-cluster">
            <WorkflowRunFilterControls
              search={search}
              facets={facets}
              onChange={onChange}
              stacked
            />
          </SheetBody>
          <SheetFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!hasActiveFilters}
              onClick={onClear}
            >
              Clear filters
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={() => setSheetOpen(false)}>
              Show runs
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function WorkflowRunFilterControls({
  search,
  facets,
  onChange,
  stacked = false,
}: {
  search: WorkflowRunsSearch;
  facets: WorkflowRunFacets;
  onChange: (patch: WorkflowRunFilterPatch) => void;
  stacked?: boolean;
}) {
  const controlClassName = stacked ? 'w-full max-w-none' : undefined;

  return (
    <>
      <WorkflowRunFilterMenu
        label="Status"
        options={STATUS_OPTIONS}
        selected={search.status ?? []}
        onChange={(next) => onChange({status: next as WorkflowRunListStatus[]})}
        emptyMessage="No statuses available."
        className={controlClassName}
      />
      <WorkflowRunFilterMenu
        label="Branch"
        options={toOptions(facets.branch)}
        selected={search.branch ?? []}
        onChange={(branch) => onChange({branch})}
        emptyMessage="No branches in the loaded runs."
        className={controlClassName}
      />
      <WorkflowRunFilterMenu
        label="Actor"
        options={toOptions(facets.actor)}
        selected={search.actor ?? []}
        onChange={(actor) => onChange({actor})}
        emptyMessage="No actors in the loaded runs."
        className={controlClassName}
      />
      <WorkflowRunFilterMenu
        label="Event"
        options={toOptions(facets.event)}
        selected={search.event ?? []}
        onChange={(event) => onChange({event})}
        emptyMessage="No events in the loaded runs."
        className={controlClassName}
      />
      {stacked ? (
        <div className="flex flex-col gap-inline">
          <Label>Created between</Label>
          <RunDateRangeFilter search={search} onChange={onChange} />
        </div>
      ) : (
        <RunDateRangeFilter search={search} onChange={onChange} />
      )}
    </>
  );
}

function RunDateRangeFilter({
  search,
  onChange,
}: {
  search: WorkflowRunsSearch;
  onChange: (patch: WorkflowRunFilterPatch) => void;
}) {
  return (
    <DateRangePicker
      size="small"
      aria-label="Filter runs by creation date"
      // The shared picker renders a value only when both bounds are set, so a one-sided filter
      // would otherwise read as unset. Naming the active bound keeps it visible without
      // inventing the bound the user did not choose.
      placeholder={partialDateLabel(search) ?? 'Any date'}
      dateRange={{
        ...(search.after ? {start: fromCalendarDate(search.after)} : {}),
        ...(search.before ? {end: fromCalendarDate(search.before)} : {}),
      }}
      onDateRangeSelect={(range) =>
        onChange({
          after: range?.start ? toCalendarDate(range.start) : undefined,
          before: range?.end ? toCalendarDate(range.end) : undefined,
        })
      }
      onClear={() => onChange({after: undefined, before: undefined})}
    />
  );
}

function ClearFiltersButton({onClear}: {onClear: () => void}) {
  return (
    <Button
      type="button"
      variant="transparentMuted"
      size="sm"
      iconLeft="closeLine"
      onClick={onClear}
    >
      Clear filters
    </Button>
  );
}

/** Describes a bound the picker cannot display on its own, or nothing when it can. */
function partialDateLabel(search: WorkflowRunsSearch): string | undefined {
  if (search.after && search.before) return undefined;
  if (search.after) return `From ${search.after}`;
  if (search.before) return `Until ${search.before}`;
  return undefined;
}

function toOptions(values: readonly string[]): WorkflowRunFilterOption[] {
  return values.map((value) => ({value, label: value}));
}

// The bounds are local calendar dates, matching how each row's date reads, so the picker and
// the URL agree with what the list shows rather than with UTC.
function toCalendarDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromCalendarDate(value: string): Date | undefined {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
