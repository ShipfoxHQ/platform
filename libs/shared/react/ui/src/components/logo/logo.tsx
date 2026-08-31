/// <reference path="../../env.d.ts" />

'use client';

import type {ComponentProps} from 'react';
import {useResolvedTheme} from '#hooks/useResolvedTheme.js';
import {cn} from '#utils/cn.js';
import markOrange from '../../assets/logo/mark-orange.svg';
import wordmarkDark from '../../assets/logo/wordmark-dark.svg';
import wordmarkLight from '../../assets/logo/wordmark-light.svg';

type LogoVariant = 'wordmark' | 'mark';

export type LogoProps = Omit<ComponentProps<'img'>, 'src' | 'alt'> & {
  variant?: LogoVariant;
  alt?: string;
};

export function Logo({variant = 'wordmark', className, alt, ...props}: LogoProps) {
  const resolved = useResolvedTheme();
  let src = wordmarkLight;
  if (variant === 'mark') src = markOrange;
  else if (resolved === 'dark') src = wordmarkDark;
  const sizeClass = variant === 'mark' ? 'h-20 w-auto' : 'h-24 w-auto';

  return (
    <img
      src={src}
      alt={alt ?? 'Shipfox'}
      loading="eager"
      decoding="async"
      className={cn(sizeClass, className)}
      {...props}
    />
  );
}
