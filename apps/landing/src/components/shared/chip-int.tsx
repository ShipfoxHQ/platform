'use client';

import {cn} from '@shipfox/react-ui';
import type {ReactNode} from 'react';

export function ChipInt({children, className}: {children: ReactNode; className?: string}) {
  return (
    <span
      className={cn(
        'border-color-alpha-white-8 bg-background-subtle-base text-foreground-neutral-base font-code inline-flex items-center gap-6 rounded-6 border px-10 py-5 text-xs font-medium leading-none',
        className,
      )}
    >
      {children}
    </span>
  );
}
