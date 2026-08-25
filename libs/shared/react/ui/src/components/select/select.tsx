'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/index.js';

function Select({...props}: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({...props}: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({className, ...props}: ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    // Selected values are frequently names a user authored, such as a job or a workflow, and
    // nothing bounds their length. Without this the value wraps and spills out of the trigger's
    // fixed height instead of ending in an ellipsis.
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn('min-w-0 truncate text-left', className)}
      {...props}
    />
  );
}

const selectTriggerVariants = cva(
  [
    'flex items-center justify-between gap-8',
    'w-full min-w-0 rounded-6 px-8 text-sm leading-20',
    // The trigger keeps its compact height so it sits level with the metadata beside it, and
    // grows to the touch minimum only where the pointer is coarse.
    '[@media(pointer:coarse)]:min-h-44',
    'bg-background-field-base text-foreground-neutral-subtle',
    'shadow-button-neutral transition-[color,box-shadow] outline-none',
    'hover:bg-background-field-hover',
    'focus-visible:shadow-border-interactive-with-active',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-background-neutral-disabled disabled:shadow-none disabled:text-foreground-neutral-disabled',
    'data-[placeholder]:text-foreground-neutral-muted',
  ],
  {
    variants: {
      variant: {
        base: 'bg-background-field-base',
        component: 'bg-background-field-component',
      },
      size: {
        small: 'h-28 py-4',
        base: 'h-32 py-6',
      },
    },
    defaultVariants: {
      variant: 'base',
      size: 'base',
    },
  },
);

type SelectTriggerProps = ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>;

function SelectTrigger({className, variant, size, children, ...props}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(selectTriggerVariants({variant, size}), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <Icon name="expandUpDownLine" className="size-16 text-foreground-neutral-muted shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-4', className)}
      {...props}
    >
      <Icon name="arrowUpSLine" className="size-16 text-foreground-neutral-muted" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-4', className)}
      {...props}
    >
      <Icon name="arrowDownSLine" className="size-16 text-foreground-neutral-muted" />
    </SelectPrimitive.ScrollDownButton>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  align = 'center',
  container,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content> & {container?: HTMLElement | null}) {
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          'relative z-50 max-h-300 min-w-180 overflow-hidden rounded-10 p-4',
          'bg-background-neutral-overlay shadow-tooltip',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        sideOffset={sideOffset}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-slot="select-viewport"
          className={cn(
            'p-0',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({className, ...props}: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        'px-8 py-4 text-xs leading-20 text-foreground-neutral-subtle select-none',
        className,
      )}
      {...props}
    />
  );
}

type SelectItemProps = ComponentProps<typeof SelectPrimitive.Item> & {
  icon?: IconName;
};

function SelectItem({className, children, icon, ...props}: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-8 rounded-6 py-6 pl-32 pr-8',
        'text-sm leading-20 text-foreground-neutral-subtle outline-none transition-colors',
        'focus:bg-background-components-hover',
        'data-disabled:pointer-events-none data-disabled:text-foreground-neutral-disabled',
        'data-[state=checked]:text-foreground-neutral-base',
        icon && 'pl-56',
        className,
      )}
      {...props}
    >
      <span className="absolute left-8 flex size-16 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Icon name="check" className="size-14 text-foreground-neutral-base" />
        </SelectPrimitive.ItemIndicator>
      </span>
      {icon && (
        <Icon
          name={icon}
          className="size-16 shrink-0 text-foreground-neutral-subtle absolute left-32"
        />
      )}
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({className, ...props}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        'relative -mx-4 my-4 h-px',
        'bg-border-neutral-menu-top',
        'after:absolute after:inset-x-0 after:top-px after:h-px',
        'after:bg-border-neutral-menu-bottom',
        className,
      )}
      {...props}
    />
  );
}

export type {SelectItemProps, SelectTriggerProps};
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
};
