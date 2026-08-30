'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import {format, isValid} from 'date-fns';
import type {ComponentProps, MouseEvent, ReactNode} from 'react';
import {useState} from 'react';
import {Calendar} from '#components/calendar/index.js';
import {Icon} from '#components/icon/index.js';
import {Popover, PopoverContent, PopoverTrigger} from '#components/popover/index.js';
import {cn} from '#utils/cn.js';
import {buildOffsetDisabledMatcher} from './offset-disabled.js';

export const datePickerVariants = cva(
  'relative flex items-center rounded-6 shadow-button-neutral transition-[background-color,box-shadow] outline-none',
  {
    variants: {
      variant: {
        base: 'bg-background-field-base hover:bg-background-field-hover',
        component: 'bg-background-field-component hover:bg-background-field-component-hover',
      },
      size: {
        base: 'h-32',
        small: 'h-28',
      },
      state: {
        default: '',
        error: 'shadow-border-error',
        disabled:
          'bg-background-neutral-disabled shadow-none pointer-events-none cursor-not-allowed',
      },
    },
    defaultVariants: {
      variant: 'base',
      size: 'base',
      state: 'default',
    },
  },
);

export type DatePickerProps = Omit<ComponentProps<'input'>, 'size' | 'type'> &
  VariantProps<typeof datePickerVariants> & {
    date?: Date;
    onDateSelect?: (date: Date | undefined) => void;
    placeholder?: string;
    dateFormat?: string;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    onClear?: () => void;
    closeOnSelect?: boolean;
    maxDisabledOffsetDays?: number;
  };

export function DatePicker({
  className,
  variant,
  size,
  state,
  date,
  onDateSelect,
  placeholder = 'DD/MM/YYYY',
  dateFormat = 'dd/MM/yyyy',
  leftIcon,
  rightIcon,
  onClear,
  disabled,
  closeOnSelect = true,
  maxDisabledOffsetDays,
  ref,
  ...props
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const isDisabled = pickerIsDisabled(disabled, state);
  const validDate = validPickerDate(date);
  const displayValue = validDate ? format(validDate, dateFormat) : '';
  const defaultMonth = validDate ?? new Date();

  const disabledDates = buildOffsetDisabledMatcher({
    reference: new Date(),
    maxOffsetDays: maxDisabledOffsetDays,
  });

  const handleSelect = (selectedDate: Date | undefined) => {
    onDateSelect?.(selectedDate);
    if (closeOnSelect) {
      setOpen(false);
    }
  };

  const handleClear = (event: MouseEvent) => {
    event.stopPropagation();
    onClear?.();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          open && 'shadow-border-interactive-with-active',
          datePickerVariants({variant, size, state: isDisabled ? 'disabled' : state}),
          className,
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isDisabled}
            className={cn(
              'flex items-center justify-center shrink-0 transition-colors',
              size === 'small' ? 'size-28' : 'size-32',
              isDisabled && 'text-foreground-neutral-disabled',
            )}
            aria-label="Open calendar"
          >
            {leftIcon || (
              <Icon
                name="calendar2Line"
                className={cn(
                  'size-16 text-foreground-neutral-muted',
                  isDisabled && 'text-foreground-neutral-disabled',
                )}
              />
            )}
          </button>
        </PopoverTrigger>

        <div className="h-full w-px bg-border-neutral-base shrink-0" />

        <input
          ref={ref}
          type="text"
          disabled={isDisabled}
          placeholder={placeholder}
          value={displayValue}
          readOnly
          className={cn(
            'flex-1 min-w-0 px-8 text-sm leading-20 bg-transparent outline-none border-none cursor-pointer',
            'placeholder:text-foreground-neutral-muted',
            'text-foreground-neutral-base',
            'disabled:text-foreground-neutral-disabled disabled:cursor-not-allowed',
            size === 'small' ? 'py-4' : 'py-6',
          )}
          {...props}
          onClick={(event) => {
            props.onClick?.(event);
            if (!isDisabled) setOpen(true);
          }}
        />

        <button
          type="button"
          onClick={handleClear}
          className={cn(
            'flex items-center justify-center shrink-0 cursor-pointer',
            size === 'small' ? 'size-28' : 'size-32',
            date && onClear && !isDisabled ? 'visible' : 'invisible',
          )}
          aria-label="Clear date"
        >
          <Icon
            name="closeLine"
            className="size-16 text-foreground-neutral-muted hover:text-foreground-neutral-subtle transition-colors"
          />
        </button>

        {rightIcon && !date && (
          <div
            className={cn(
              'flex items-center justify-center shrink-0',
              size === 'small' ? 'size-28' : 'size-32',
            )}
          >
            {rightIcon}
          </div>
        )}
      </div>

      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          defaultMonth={defaultMonth}
          selected={validDate}
          onSelect={handleSelect}
          disabled={disabledDates}
          formatters={{
            formatWeekdayName: (weekday) => format(weekday, 'EEEEE'),
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function pickerIsDisabled(disabled: boolean | undefined, state: DatePickerProps['state']): boolean {
  return Boolean(disabled || state === 'disabled');
}

function validPickerDate(date: Date | undefined): Date | undefined {
  if (!date || !isValid(date)) return undefined;
  return date;
}
