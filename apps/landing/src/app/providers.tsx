'use client';

import {Toaster, TooltipProvider} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {CtaProvider} from '#components/cta/cta-context';
import {WaitlistModal} from '#components/cta/waitlist-modal';

export function Providers({children}: {children: ReactNode}) {
  return (
    <TooltipProvider>
      <CtaProvider>
        {children}
        <WaitlistModal />
        <Toaster />
      </CtaProvider>
    </TooltipProvider>
  );
}
