import {cn} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';

/**
 * Modal-agnostic body/footer layout matching `ModalBody`/`ModalFooter` so the
 * forms render the same inside a `ModalContent` and standalone (stories, RTL
 * tests) without a Modal context.
 */
export function FormBody({children, className}: {children: ReactNode; className?: string}) {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-start gap-group bg-background-neutral-base px-frame pt-[16px] pb-[24px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FormFooter({children}: {children: ReactNode}) {
  return (
    <div className="flex w-full shrink-0 flex-col">
      <div className="h-[1px] w-full bg-border-neutral-strong" />
      <div className="flex w-full items-center justify-end gap-group bg-background-neutral-base px-frame py-[16px]">
        {children}
      </div>
    </div>
  );
}
