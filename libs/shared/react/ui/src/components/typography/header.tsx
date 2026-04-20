import {cva, type VariantProps} from 'class-variance-authority';
import type {ElementType, HTMLAttributes, PropsWithChildren} from 'react';
import {cn} from '#utils/index.js';

export const headerVariants = cva('', {
  variants: {
    variant: {
      h1: 'text-3xl',
      h2: 'text-xl',
      h3: 'text-lg',
      h4: 'text-md',
    },
  },
  defaultVariants: {
    variant: 'h1',
  },
});

const components = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
} as const;

export type HeaderProps = PropsWithChildren<HTMLAttributes<HTMLParagraphElement>> &
  VariantProps<typeof headerVariants> & {
    as?: ElementType;
  };

export function Header({children, className, variant, as, ...props}: HeaderProps) {
  const Component = as ?? (variant ? components[variant] : 'h1');
  return (
    <Component
      className={cn(headerVariants({variant}), 'font-display font-medium', className)}
      {...props}
    >
      {children}
    </Component>
  );
}
