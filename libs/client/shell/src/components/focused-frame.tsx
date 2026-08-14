import {cn} from '@shipfox/react-ui/utils';
import type {PropsWithChildren} from 'react';

export const FOCUSED_FRAME_CONTENT_CLASS_NAME = 'mx-auto w-full max-w-[640px]';

export function FocusedFrame({
  children,
  className,
}: PropsWithChildren<{className?: string | undefined}>) {
  return <div className={cn(FOCUSED_FRAME_CONTENT_CLASS_NAME, className)}>{children}</div>;
}
