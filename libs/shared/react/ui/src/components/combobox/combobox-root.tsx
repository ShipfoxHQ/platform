'use client';

import * as React from 'react';
import {Popover} from '../popover/index.js';
import {ComboboxContext, type ComboboxContextValue, comboboxOptionId} from './combobox-context.js';
import {
  assertValidComboboxOptions,
  type ComboboxOption,
  clearMultiComboboxValues,
  filterComboboxOptions,
  getNextActiveComboboxValue,
  removeMultiComboboxValue,
  resolveComboboxLabel,
  toggleMultiComboboxValue,
  toggleSingleComboboxValue,
} from './combobox-state.js';

type ComboboxRootBaseProps = {
  options: ComboboxOption[];
  children: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
  maxVisibleChips?: number;
};

type SingleControlledComboboxRootProps = ComboboxRootBaseProps & {
  multiple?: false;
  value: string;
  defaultValue?: never;
  onValueChange?: (value: string) => void;
};

type SingleUncontrolledComboboxRootProps = ComboboxRootBaseProps & {
  multiple?: false;
  value?: never;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type MultiControlledComboboxRootProps = ComboboxRootBaseProps & {
  multiple: true;
  value: string[];
  defaultValue?: never;
  onValueChange?: (value: string[]) => void;
};

type MultiUncontrolledComboboxRootProps = ComboboxRootBaseProps & {
  multiple: true;
  value?: never;
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

export type ComboboxRootProps =
  | SingleControlledComboboxRootProps
  | SingleUncontrolledComboboxRootProps
  | MultiControlledComboboxRootProps
  | MultiUncontrolledComboboxRootProps;

export function ComboboxRoot(props: ComboboxRootProps) {
  const {options, children, disabled = false, isLoading = false, maxVisibleChips} = props;
  assertValidComboboxOptions(options);
  const multiple = props.multiple === true;
  // Selection callbacks are intentionally stable; read the latest controlled props
  // through a ref so `onValueChange` updates do not force the whole context to churn.
  const propsRef = React.useRef(props);
  propsRef.current = props;
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');
  const [activeValue, setActiveValue] = React.useState<string | null>(null);
  const [internalSingleValue, setInternalSingleValue] = React.useState(
    !multiple ? (props.defaultValue ?? '') : '',
  );
  const [internalMultiValue, setInternalMultiValue] = React.useState(
    multiple ? (props.defaultValue ?? []) : [],
  );
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (disabled && nextOpen) {
        return;
      }
      setOpen(nextOpen);
    },
    [disabled],
  );

  React.useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const selectedValue = multiple
    ? ''
    : ((props as SingleControlledComboboxRootProps | SingleUncontrolledComboboxRootProps).value ??
      internalSingleValue);
  const controlledMultiValue = multiple
    ? (props as MultiControlledComboboxRootProps | MultiUncontrolledComboboxRootProps).value
    : undefined;
  const selectedValues = React.useMemo<string[]>(() => {
    if (multiple) return controlledMultiValue ?? internalMultiValue;
    if (selectedValue) return [selectedValue];
    return [];
  }, [multiple, controlledMultiValue, internalMultiValue, selectedValue]);

  const visibleOptions = React.useMemo(
    () => filterComboboxOptions(options, searchValue),
    [options, searchValue],
  );

  const updateSingleValue = React.useCallback(
    (nextValue: string) => {
      const singleProps = propsRef.current as
        | SingleControlledComboboxRootProps
        | SingleUncontrolledComboboxRootProps;

      if (!multiple && singleProps.value === undefined) {
        setInternalSingleValue(nextValue);
      }
      if (!multiple) {
        singleProps.onValueChange?.(nextValue);
      }
    },
    [multiple],
  );

  const updateMultiValue = React.useCallback(
    (nextValues: string[]) => {
      const multiProps = propsRef.current as
        | MultiControlledComboboxRootProps
        | MultiUncontrolledComboboxRootProps;

      if (multiple && multiProps.value === undefined) {
        setInternalMultiValue(nextValues);
      }
      if (multiple) {
        multiProps.onValueChange?.(nextValues);
      }
    },
    [multiple],
  );

  const getLabel = React.useCallback(
    (value: string) => resolveComboboxLabel(options, value),
    [options],
  );

  const isSelected = React.useCallback(
    (value: string) => (multiple ? selectedValues.includes(value) : selectedValue === value),
    [multiple, selectedValue, selectedValues],
  );

  const selectValue = React.useCallback(
    (value: string) => {
      if (disabled) {
        return;
      }

      if (multiple) {
        updateMultiValue(toggleMultiComboboxValue(selectedValues, value));
        setSearchValue('');
        return;
      }

      updateSingleValue(toggleSingleComboboxValue(selectedValue, value));
      setSearchValue('');
      setOpen(false);
    },
    [disabled, multiple, selectedValue, selectedValues, updateMultiValue, updateSingleValue],
  );

  const removeValue = React.useCallback(
    (value: string) => {
      if (disabled || !multiple) {
        return;
      }
      updateMultiValue(removeMultiComboboxValue(selectedValues, value));
    },
    [disabled, multiple, selectedValues, updateMultiValue],
  );

  const removeLastValue = React.useCallback(() => {
    if (disabled || !multiple || selectedValues.length === 0) {
      return;
    }
    updateMultiValue(selectedValues.slice(0, -1));
  }, [disabled, multiple, selectedValues, updateMultiValue]);

  const clearValues = React.useCallback(() => {
    if (disabled || !multiple) {
      return;
    }
    updateMultiValue(clearMultiComboboxValues());
  }, [disabled, multiple, updateMultiValue]);

  const handleArrowKey = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, direction: 1 | -1) => {
      event.preventDefault();
      if (!open) {
        handleOpenChange(true);
        return;
      }
      const values = visibleOptions.map((option) => option.value);
      setActiveValue(getNextActiveComboboxValue(values, activeValue, direction));
    },
    [activeValue, handleOpenChange, open, visibleOptions],
  );

  const handleBoundaryKey = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, boundary: 'start' | 'end') => {
      // Leave Home/End to the text caret while there is a query to navigate.
      if (!open || searchValue !== '') return;
      event.preventDefault();
      const values = visibleOptions.map((option) => option.value);
      setActiveValue(boundary === 'start' ? (values[0] ?? null) : (values.at(-1) ?? null));
    },
    [open, searchValue, visibleOptions],
  );

  const handleEnterKey = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Swallow Enter while open so it selects (when an option is active) and
      // never submits an enclosing form, even with an empty result list.
      if (!open) return;
      event.preventDefault();
      if (activeValue !== null) selectValue(activeValue);
    },
    [activeValue, open, selectValue],
  );

  const handleEscapeKey = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open) return;
      event.preventDefault();
      handleOpenChange(false);
    },
    [handleOpenChange, open],
  );

  const onListKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          handleArrowKey(event, 1);
          return;
        case 'ArrowUp':
          handleArrowKey(event, -1);
          return;
        case 'Home':
          handleBoundaryKey(event, 'start');
          return;
        case 'End':
          handleBoundaryKey(event, 'end');
          return;
        case 'Enter':
          handleEnterKey(event);
          return;
        case 'Escape':
          handleEscapeKey(event);
          return;
        default:
      }
    },
    [disabled, handleArrowKey, handleBoundaryKey, handleEnterKey, handleEscapeKey],
  );

  // Keep the active option valid. Preserve the user's highlight as long as it still
  // matches the filter (so arrow position survives unrelated re-renders, even when the
  // consumer passes a fresh `options` array); otherwise fall back to the first match.
  // The functional updater intentionally avoids depending on `activeValue` so a stable
  // result bails out instead of looping.
  React.useEffect(() => {
    setActiveValue((current) => {
      if (!open) return null;
      if (current !== null && visibleOptions.some((option) => option.value === current)) {
        return current;
      }
      return visibleOptions[0]?.value ?? null;
    });
  }, [open, visibleOptions]);

  // Focus stays on the input, so the browser will not scroll the active option into
  // view on its own; do it ourselves. `nearest` is a no-op when it is already visible.
  React.useEffect(() => {
    if (!open || activeValue === null) {
      return;
    }
    document.getElementById(comboboxOptionId(listId, activeValue))?.scrollIntoView({
      block: 'nearest',
    });
  }, [open, activeValue, listId]);

  const contextValue = React.useMemo<ComboboxContextValue>(
    () => ({
      options,
      multiple,
      disabled,
      isLoading,
      maxVisibleChips,
      listId,
      open,
      setOpen: handleOpenChange,
      searchValue,
      setSearchValue,
      visibleOptions,
      activeValue,
      setActiveValue,
      selectedValue,
      selectedValues,
      getLabel,
      isSelected,
      selectValue,
      removeValue,
      removeLastValue,
      clearValues,
      onListKeyDown,
    }),
    [
      options,
      multiple,
      disabled,
      isLoading,
      maxVisibleChips,
      listId,
      open,
      searchValue,
      visibleOptions,
      activeValue,
      selectedValue,
      selectedValues,
      getLabel,
      isSelected,
      selectValue,
      removeValue,
      removeLastValue,
      clearValues,
      onListKeyDown,
      handleOpenChange,
    ],
  );

  return (
    <ComboboxContext.Provider value={contextValue}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {children}
      </Popover>
    </ComboboxContext.Provider>
  );
}
