import * as LabelPrimitive from '@radix-ui/react-label';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

export const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

export type LabelProps = ComponentProps<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>;

export function Label({className, ...props}: LabelProps) {
  return <LabelPrimitive.Root className={cn(labelVariants(), className)} {...props} />;
}
