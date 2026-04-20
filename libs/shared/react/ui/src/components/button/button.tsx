import {Slot, Slottable} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/index.js';

export const buttonVariants = cva(
  'rounded-6 inline-flex items-center justify-center whitespace-nowrap transition-colors cursor-pointer disabled:pointer-events-none shrink-0 outline-none',
  {
    variants: {
      variant: {
        primary:
          'bg-background-button-inverted-default text-foreground-contrast-primary shadow-button-inverted hover:bg-background-button-inverted-hover active:bg-background-button-inverted-pressed focus-visible:shadow-button-inverted-focus disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled disabled:shadow-none',
        secondary:
          'bg-background-button-neutral-default text-foreground-neutral-base shadow-button-neutral hover:bg-background-button-neutral-hover active:bg-background-button-neutral-pressed disabled:bg-background-neutral-disabled focus-visible:shadow-button-neutral-focus disabled:text-foreground-neutral-disabled disabled:shadow-none',
        danger:
          'bg-background-button-danger-default text-foreground-neutral-on-color shadow-button-danger hover:bg-background-button-danger-hover active:bg-background-button-danger-pressed focus-visible:shadow-button-danger-focus disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled disabled:shadow-none',
        success:
          'bg-background-button-success-default text-foreground-neutral-on-color shadow-button-success hover:bg-background-button-success-hover active:bg-background-button-success-pressed focus-visible:shadow-button-success-focus disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled disabled:shadow-none',
        transparent:
          'bg-background-button-transparent-default text-foreground-neutral-base hover:bg-background-button-transparent-hover active:bg-background-button-transparent-pressed focus-visible:shadow-button-neutral-focus disabled:text-foreground-neutral-disabled',
        transparentMuted:
          'bg-background-button-transparent-default text-foreground-neutral-muted hover:bg-background-button-transparent-hover active:bg-background-button-transparent-pressed focus-visible:shadow-button-neutral-focus disabled:text-foreground-neutral-disabled',
      },
      size: {
        '2xs': 'h-20 px-6 text-xs gap-4',
        xs: 'h-24 px-6 text-xs gap-4',
        sm: 'h-28 px-8 text-sm gap-6',
        md: 'h-32 px-10 text-md gap-8',
        lg: 'h-36 px-12 text-lg gap-8',
        xl: 'h-40 px-12 text-xl gap-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

const iconSizeMap: Record<NonNullable<VariantProps<typeof buttonVariants>['size']>, string> = {
  '2xs': 'size-14',
  xs: 'size-16',
  sm: 'size-20',
  md: 'size-20',
  lg: 'size-20',
  xl: 'size-20',
};

export function Button({
  className,
  variant,
  size,
  asChild = false,
  children,
  iconLeft,
  iconRight,
  isLoading = false,
  disabled,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    iconLeft?: IconName;
    iconRight?: IconName;
    isLoading?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';
  const resolvedSize = (size ?? 'md') as NonNullable<VariantProps<typeof buttonVariants>['size']>;
  const iconSize = iconSizeMap[resolvedSize];

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({variant, size, className}))}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      aria-live={isLoading ? 'polite' : undefined}
      {...(asChild ? {'aria-disabled': disabled || isLoading} : {})}
      {...props}
    >
      {isLoading ? (
        <Icon name="spinner" className={iconSize} />
      ) : (
        iconLeft && <Icon name={iconLeft} className={iconSize} />
      )}
      <Slottable>{children}</Slottable>
      {iconRight && <Icon name={iconRight} className={iconSize} />}
    </Comp>
  );
}
