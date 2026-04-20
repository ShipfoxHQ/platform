import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps, ReactNode} from 'react';
import {forwardRef} from 'react';
import {cn} from '#utils/cn.js';

export const inputVariants = cva('', {
  variants: {
    variant: {
      base: 'bg-background-field-base',
      component: 'bg-background-field-component',
    },
    size: {
      base: 'py-6',
      small: 'py-4',
    },
  },
  defaultVariants: {
    variant: 'base',
    size: 'base',
  },
});

type InputProps = Omit<ComponentProps<'input'>, 'size'> &
  VariantProps<typeof inputVariants> & {
    iconLeft?: ReactNode;
    iconRight?: ReactNode;
  };

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({className, type, variant, size, iconLeft, iconRight, ...props}, ref) => {
    return (
      <div className="relative flex items-center w-full">
        {iconLeft && (
          <div className="absolute left-8 top-1/2 -translate-y-1/2 flex items-center justify-center shrink-0 pointer-events-none z-10">
            {iconLeft}
          </div>
        )}
        <input
          ref={ref}
          type={type}
          data-slot="input"
          className={cn(
            'placeholder:text-foreground-neutral-muted w-full min-w-0 rounded-6 text-sm leading-20 text-foreground-neutral-base shadow-button-neutral transition-[color,box-shadow] outline-none',
            'hover:bg-background-field-hover',
            'selection:bg-background-accent-neutral-soft selection:text-foreground-neutral-on-inverted',
            'file:text-foreground-neutral-base file:inline-flex file:font-medium',
            'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-background-neutral-disabled disabled:shadow-none disabled:text-foreground-neutral-disabled',
            'focus-visible:shadow-border-interactive-with-active',
            'aria-invalid:shadow-border-error',
            iconLeft ? 'pl-32' : 'pl-8',
            iconRight ? 'pr-32' : 'pr-8',
            inputVariants({variant, size}),
            className,
          )}
          {...props}
        />
        {iconRight && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2 flex items-center justify-center shrink-0 pointer-events-none z-10">
            {iconRight}
          </div>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
