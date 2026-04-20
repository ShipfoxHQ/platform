import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {ShipfoxLoader} from './shipfox-loader.js';

export function FullPageLoader({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="full-page-loader"
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className={cn('flex h-dvh items-center justify-center bg-background-subtle-base', className)}
      {...props}
    >
      <ShipfoxLoader size={64} animation="circular" color="orange" background="dark" />
    </div>
  );
}
