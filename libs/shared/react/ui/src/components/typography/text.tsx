import {cva, type VariantProps} from 'class-variance-authority';
import type {ElementType, HTMLAttributes, PropsWithChildren} from 'react';
import {cn} from '#utils/index.js';

export const textVariants = cva('', {
  variants: {
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-md',
      lg: 'text-lg',
      xl: 'text-xl',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export type TextProps = PropsWithChildren<HTMLAttributes<HTMLParagraphElement>> &
  VariantProps<typeof textVariants> & {
    as?: ElementType;
    compact?: boolean;
    bold?: boolean;
  };

export function Text({
  children,
  className,
  size,
  as,
  compact = true,
  bold = false,
  ...props
}: TextProps) {
  const Component = as ?? 'p';
  return (
    <Component
      className={cn(
        textVariants({size}),
        'font-display',
        {'leading-20': compact, 'font-medium': bold},
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
