import {cva, type VariantProps} from 'class-variance-authority';
import type {ElementType, HTMLAttributes, PropsWithChildren} from 'react';
import {cn} from '#utils/index.js';

export const codeVariants = cva('', {
  variants: {
    variant: {
      label: 'text-xs',
      paragraph: 'text-sm',
    },
  },
  defaultVariants: {
    variant: 'paragraph',
  },
});

export type CodeProps = PropsWithChildren<HTMLAttributes<HTMLParagraphElement>> &
  VariantProps<typeof codeVariants> & {
    as?: ElementType;
    bold?: boolean;
  };

export function Code({children, className, variant, as, bold, ...props}: CodeProps) {
  const Component = as ?? 'p';
  return (
    <Component
      className={cn(
        codeVariants({variant}),
        'leading-20 font-code',
        {'font-bold': bold},
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
