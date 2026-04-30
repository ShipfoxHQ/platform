'use client';

import {Button} from '@shipfox/react-ui';
import type {ComponentProps} from 'react';
import {useCta} from './cta-context';

type CtaButtonProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'variant'> & {
  variant?: 'accent' | 'secondary';
};

export function CtaButton({variant = 'accent', className, ...props}: CtaButtonProps) {
  const {open} = useCta();
  const accentClasses =
    'bg-color-primary-400 text-color-neutral-1000 shipfox-shadow-cta hover:bg-color-primary-300 active:bg-color-primary-500 font-medium';
  return (
    <Button
      variant="secondary"
      size="md"
      iconLeft="flashlightFill"
      onClick={open}
      className={[variant === 'accent' ? accentClasses : '', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
