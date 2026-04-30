'use client';

import {Icon} from '@shipfox/react-ui';
import type {ReactNode} from 'react';

export function Eyebrow({children}: {children: ReactNode}) {
  return (
    <div className="text-color-primary-400 font-code inline-flex items-center gap-8 rounded-full border border-[rgba(255,75,0,.28)] bg-[rgba(255,75,0,.10)] px-10 py-5 text-xs font-medium uppercase leading-none tracking-[.06em]">
      <Icon name="flashlightFill" className="size-14" />
      {children}
    </div>
  );
}
