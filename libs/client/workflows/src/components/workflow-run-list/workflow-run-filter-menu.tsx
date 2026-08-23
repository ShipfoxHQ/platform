import {Button} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';

export interface WorkflowRunFilterOption {
  value: string;
  label: string;
}

export interface WorkflowRunFilterMenuProps {
  label: string;
  options: readonly WorkflowRunFilterOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** Shown in place of the option list when nothing is loaded to filter by. */
  emptyMessage: string;
  /**
   * Single-select mode: picking an option replaces the selection, and picking the option
   * already selected clears it back to "everything". Facets whose vocabulary is a fixed
   * enum (origin) are single-valued on the server, so a multi-select would have no URL.
   */
  single?: boolean | undefined;
  className?: string | undefined;
}

/**
 * One multi-select filter.
 *
 * The trigger states its own value rather than only a count, because a toolbar of five
 * buttons that all read "Branch" forces the user to open each one to find out what is on.
 * Checked items keep the menu open: choosing two branches should not cost two round trips.
 */
export function WorkflowRunFilterMenu({
  label,
  options,
  selected,
  onChange,
  emptyMessage,
  single = false,
  className,
}: WorkflowRunFilterMenuProps) {
  const active = selected.length > 0;
  const triggerText = triggerLabel(label, options, selected);

  function toggle(value: string) {
    if (single) {
      onChange(selected.includes(value) ? [] : [value]);
      return;
    }
    onChange(
      selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value],
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconRight="arrowDownSLine"
          // Mirrors the visible label so the selected value is not sighted-only; an aria-label
          // replaces the button's contents as its accessible name rather than adding to them.
          aria-label={`${triggerText} filter`}
          className={cn('max-w-[200px]', !active && 'text-foreground-neutral-subtle', className)}
        >
          <span className="min-w-0 truncate">{triggerText}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] w-[240px] overflow-y-auto">
        {options.length === 0 ? (
          <Text as="p" size="xs" className="px-tight py-[6px] text-foreground-neutral-muted">
            {emptyMessage}
          </Text>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              closeOnSelect={false}
              onSelect={() => toggle(option.value)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function triggerLabel(
  label: string,
  options: readonly WorkflowRunFilterOption[],
  selected: readonly string[],
): string {
  if (selected.length === 0) return label;
  if (selected.length === 1) {
    const [value] = selected;
    const option = options.find((entry) => entry.value === value);
    return `${label}: ${option?.label ?? value}`;
  }
  return `${label} · ${selected.length}`;
}
