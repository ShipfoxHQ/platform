import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/index.js';

export const iconButtonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap transition-colors cursor-pointer disabled:pointer-events-none shrink-0 outline-none',
  {
    variants: {
      variant: {
        primary:
          'bg-background-button-inverted-default text-tag-neutral-icon shadow-button-inverted hover:bg-background-button-inverted-hover active:bg-background-button-inverted-pressed focus-visible:shadow-button-inverted-focus disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled disabled:shadow-none',
        transparent:
          'bg-background-button-transparent-default text-tag-neutral-icon hover:bg-background-button-transparent-hover active:bg-background-button-transparent-pressed focus-visible:shadow-button-neutral-focus disabled:text-foreground-neutral-disabled',
      },
      size: {
        '2xs': 'w-20 h-20 text-xs',
        xs: 'w-24 h-24 text-xs',
        sm: 'w-28 h-28 text-sm',
        md: 'w-32 h-32 text-md',
        lg: 'w-36 h-36 text-lg',
        xl: 'w-40 h-40 text-xl',
      },
      radius: {
        rounded: 'rounded-6',
        full: 'rounded-full',
      },
      muted: {
        true: 'opacity-60',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      radius: 'rounded',
      muted: false,
    },
  },
);

const spinnerSizeMap: Record<
  NonNullable<VariantProps<typeof iconButtonVariants>['size']>,
  string
> = {
  '2xs': 'size-8',
  xs: 'size-10',
  sm: 'size-12',
  md: 'size-14',
  lg: 'size-16',
  xl: 'size-18',
};

export function IconButton({
  className,
  variant,
  size,
  radius,
  muted,
  asChild = false,
  children,
  icon,
  isLoading = false,
  disabled,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof iconButtonVariants> & {
    asChild?: boolean;
    icon?: IconName;
    isLoading?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';
  const spinnerSize = spinnerSizeMap[size ?? 'md'];

  return (
    <Comp
      data-slot="icon-button"
      className={cn(iconButtonVariants({variant, size, radius, muted}), className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      aria-live={isLoading ? 'polite' : undefined}
      {...(asChild ? {'aria-disabled': disabled || isLoading} : {})}
      {...props}
    >
      {isLoading ? (
        <Icon name="spinner" className={spinnerSize} />
      ) : icon ? (
        <Icon name={icon} />
      ) : (
        children
      )}
    </Comp>
  );
}
