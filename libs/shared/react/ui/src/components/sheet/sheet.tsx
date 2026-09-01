'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps} from 'react';
import {useBodyPointerEventsRelease} from '#hooks/useBodyPointerEventsRelease.js';
import {useMediaQuery} from '#hooks/useMediaQuery.js';
import {cn} from '#utils/cn.js';
import {Button} from '../button/index.js';
import {Icon} from '../icon/index.js';
import {Kbd} from '../kbd/index.js';

// See modal.tsx: a closing overlay keeps covering the page for the length of its
// exit animation, so it must stop catching clicks as soon as it starts closing.
const sheetOverlayVariants = cva(
  'fixed inset-0 z-40 bg-background-backdrop-backdrop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none!',
);

const sheetContentVariants = cva(
  [
    'fixed z-50 gap-4 bg-background-neutral-base shadow-tooltip transition ease-in-out',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:pointer-events-none!',
    'data-[state=closed]:duration-300 data-[state=open]:duration-500',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  ],
  {
    variants: {
      side: {
        top: [
          'inset-x-0 top-0 border-b border-border-neutral-strong',
          'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        ],
        bottom: [
          'inset-x-0 bottom-0 border-t border-border-neutral-strong',
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        ],
        left: [
          'inset-y-0 left-0 h-full w-3/4 border-r border-border-neutral-strong sm:max-w-sm',
          'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        ],
        right: [
          'inset-y-0 right-0 h-full w-3/4 border-l border-border-neutral-strong sm:max-w-sm',
          'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        ],
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
);

function Sheet({onOpenChange, ...props}: ComponentProps<typeof DialogPrimitive.Root>) {
  const trackOpenChange = useBodyPointerEventsRelease(props.open ?? props.defaultOpen);

  function handleOpenChange(nextOpen: boolean) {
    trackOpenChange(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return <DialogPrimitive.Root data-slot="sheet" {...props} onOpenChange={handleOpenChange} />;
}

function SheetTrigger({className, ...props}: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return (
    <DialogPrimitive.Trigger
      data-slot="sheet-trigger"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

function SheetPortal({...props}: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetClose({className, ...props}: ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      data-slot="sheet-close"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

type SheetOverlayProps = ComponentProps<typeof DialogPrimitive.Overlay>;

function SheetOverlay({className, ...props}: SheetOverlayProps) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(sheetOverlayVariants(), className)}
      {...props}
    />
  );
}

type SheetContentProps = ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof sheetContentVariants> & {
    container?: HTMLElement | null;
  };

function SheetContent({
  side = 'right',
  className,
  children,
  container,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal container={container}>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(sheetContentVariants({side}), className)}
        {...props}
      >
        <div className="relative size-full flex flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0 shadow-separator-inset" />
          {children}
        </div>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

type SheetHeaderProps = ComponentProps<'div'> & {
  showEscIndicator?: boolean;
  showClose?: boolean;
};

function SheetHeader({
  className,
  showEscIndicator = true,
  showClose = true,
  children,
  ...props
}: SheetHeaderProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return (
    <div className="flex flex-col w-full shrink-0" {...props}>
      <div
        className={cn(
          'border-b border-border-neutral-strong bg-background-neutral-base flex items-center justify-center gap-12 sm:gap-20 overflow-clip px-16 py-12 sm:px-24 sm:py-16 w-full',
          className,
        )}
      >
        <div className="flex-1 min-w-0">{children}</div>
        <div className="flex items-center gap-8 shrink-0">
          {isDesktop && showEscIndicator && <Kbd>Esc</Kbd>}
          {showClose && (
            <SheetClose asChild>
              <Button
                variant="transparent"
                size="xs"
                aria-label="Close"
                className="rounded-4 p-2 cursor-pointer bg-transparent border-none text-foreground-neutral-muted hover:text-foreground-neutral-base hover:bg-background-components-hover transition-colors duration-150 outline-none focus-visible:shadow-button-neutral-focus w-24 h-24"
              >
                <Icon name="close" />
              </Button>
            </SheetClose>
          )}
        </div>
      </div>
    </div>
  );
}

type SheetFooterProps = ComponentProps<'div'>;

function SheetFooter({className, ...props}: SheetFooterProps) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'flex flex-col-reverse gap-8 sm:flex-row sm:justify-end sm:space-x-2 px-16 py-12 sm:px-24 sm:py-16 border-t border-border-neutral-strong bg-background-neutral-base',
        className,
      )}
      {...props}
    />
  );
}

type SheetTitleProps = ComponentProps<typeof DialogPrimitive.Title>;

function SheetTitle({className, ...props}: SheetTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        'font-medium text-base sm:text-lg leading-20 overflow-ellipsis overflow-hidden text-foreground-neutral-base sm:whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

type SheetDescriptionProps = ComponentProps<typeof DialogPrimitive.Description>;

function SheetDescription({className, ...props}: SheetDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm leading-20 text-foreground-neutral-subtle', className)}
      {...props}
    />
  );
}

type SheetBodyProps = ComponentProps<'div'>;

function SheetBody({className, children, ...props}: SheetBodyProps) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        'bg-background-neutral-base flex flex-col items-start px-16 pb-16 pt-12 sm:px-24 sm:pb-24 sm:pt-16 w-full overflow-y-auto overflow-x-clip scrollbar flex-1',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type {
  SheetBodyProps,
  SheetContentProps,
  SheetDescriptionProps,
  SheetFooterProps,
  SheetHeaderProps,
  SheetOverlayProps,
  SheetTitleProps,
};
export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
  sheetContentVariants,
  sheetOverlayVariants,
};
