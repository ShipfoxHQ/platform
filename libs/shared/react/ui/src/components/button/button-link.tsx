import {Slot, Slottable} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/index.js';

export const buttonLinkVariants = cva(
  'inline-flex items-center justify-center gap-4 whitespace-nowrap transition-colors cursor-pointer disabled:pointer-events-none outline-none font-medium',
  {
    variants: {
      variant: {
        base: 'text-foreground-neutral-base hover:text-foreground-neutral-base focus-visible:text-foreground-neutral-base disabled:text-foreground-neutral-disabled',
        interactive:
          'text-foreground-highlight-interactive hover:text-foreground-highlight-interactive-hover focus-visible:text-foreground-highlight-interactive disabled:text-foreground-neutral-disabled',
        muted:
          'text-foreground-neutral-muted hover:text-foreground-neutral-base focus-visible:text-foreground-neutral-base disabled:text-foreground-neutral-disabled',
        subtle:
          'text-foreground-neutral-subtle hover:text-foreground-neutral-base focus-visible:text-foreground-neutral-base disabled:text-foreground-neutral-disabled',
      },
      size: {
        xs: 'text-xs',
        sm: 'text-sm',
        md: 'text-md',
        xl: 'text-xl',
      },
      underline: {
        true: 'underline decoration-solid [text-underline-position:from-font]',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'base',
      size: 'sm',
      underline: false,
    },
  },
);

const iconSizeMap = {
  xs: 14,
  sm: 14,
  md: 16,
  xl: 20,
} as const;

export function ButtonLink({
  className,
  variant,
  size = 'sm',
  underline,
  asChild = false,
  children,
  iconLeft,
  iconRight,
  ...props
}: ComponentProps<'a'> &
  VariantProps<typeof buttonLinkVariants> & {
    asChild?: boolean;
    iconLeft?: IconName;
    iconRight?: IconName;
  }) {
  const Comp = asChild ? Slot : 'a';
  const iconSize = iconSizeMap[size as keyof typeof iconSizeMap];

  return (
    <Comp
      data-slot="button-link"
      className={cn(buttonLinkVariants({variant, size, underline, className}))}
      {...props}
    >
      {iconLeft && <Icon name={iconLeft} size={iconSize} />}
      <Slottable>{children}</Slottable>
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </Comp>
  );
}
