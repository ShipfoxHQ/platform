'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import {cva} from 'class-variance-authority';
import {type ComponentProps, createContext, type ReactNode, useContext, useState} from 'react';
import {Drawer as VaulDrawer} from 'vaul';
import {useBodyPointerEventsRelease} from '#hooks/useBodyPointerEventsRelease.js';
import {useMediaQuery} from '#hooks/useMediaQuery.js';
import {cn} from '#utils/cn.js';
import {Button} from '../button/index.js';
import {Icon} from '../icon/index.js';
import {Kbd} from '../kbd/index.js';
import {Header, Text} from '../typography/index.js';

type ModalContextValue = {
  breakpoint: string;
  isDesktop: boolean;
};

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('Modal components must be used within a Modal component');
  }
  return context;
}

// A closing surface outlives its dialog: the overlay keeps covering the page for
// the length of its exit animation, and Radix gives it `pointer-events: auto`.
// Dropping pointer events on `data-state=closed` keeps a fading — or stuck —
// overlay from eating clicks meant for the page behind it.
const modalOverlayVariants = cva(
  'fixed inset-0 z-40 bg-background-backdrop-backdrop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none!',
);

const modalContentVariants = cva(
  'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-32px)] flex-col overflow-clip bg-background-neutral-base rounded-16 w-full max-w-[576px] -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:pointer-events-none! shadow-tooltip',
);

function Modal({
  breakpoint = '(min-width: 768px)',
  children,
  onOpenChange,
  ...props
}: ComponentProps<typeof DialogPrimitive.Root> & {breakpoint?: string}) {
  const isDesktop = useMediaQuery(breakpoint);
  // Mirrors the open state so uncontrolled callers are covered too.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(props.defaultOpen ?? false);

  useBodyPointerEventsRelease(props.open ?? uncontrolledOpen);

  const contextValue: ModalContextValue = {
    breakpoint,
    isDesktop,
  };

  const Root = isDesktop ? DialogPrimitive.Root : VaulDrawer.Root;

  function handleOpenChange(nextOpen: boolean) {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <ModalContext.Provider value={contextValue}>
      <Root {...props} onOpenChange={handleOpenChange}>
        {children}
      </Root>
    </ModalContext.Provider>
  );
}

function ModalTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  const {isDesktop} = useModalContext();

  if (isDesktop) {
    return <DialogPrimitive.Trigger {...props} />;
  }

  return <VaulDrawer.Trigger {...props} />;
}

function ModalPortal(props: ComponentProps<typeof DialogPrimitive.Portal>) {
  const {isDesktop} = useModalContext();

  if (isDesktop) {
    return <DialogPrimitive.Portal {...props} />;
  }

  return <VaulDrawer.Portal {...props} />;
}

function ModalClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  const {isDesktop} = useModalContext();

  if (isDesktop) {
    return <DialogPrimitive.Close {...props} />;
  }

  return <VaulDrawer.Close {...props} />;
}

type ModalOverlayProps = ComponentProps<typeof DialogPrimitive.Overlay>;

function ModalOverlay({className, ...props}: ModalOverlayProps) {
  const {isDesktop} = useModalContext();

  if (!isDesktop) {
    return <VaulDrawer.Overlay className={cn(modalOverlayVariants(), className)} {...props} />;
  }

  return <DialogPrimitive.Overlay className={cn(modalOverlayVariants(), className)} {...props} />;
}

type ModalContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
};

function ModalContent({className, children, overlayClassName, ...props}: ModalContentProps) {
  const {isDesktop} = useModalContext();

  if (!isDesktop) {
    return (
      <ModalPortal>
        <ModalOverlay className={overlayClassName} />
        <VaulDrawer.Content
          className={cn(
            'fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-background-neutral-base rounded-t-16 max-h-[85vh] shadow-tooltip data-[state=closed]:pointer-events-none!',
            className,
          )}
          {...props}
        >
          <div className="relative w-full h-full flex flex-col min-h-0">
            <div className="pointer-events-none absolute inset-0 shadow-separator-inset rounded-t-16" />
            <div className="flex items-center justify-center pt-8 pb-8 shrink-0">
              <div className="bg-foreground-neutral-subtle w-32 h-4 rounded-full opacity-40" />
            </div>
            {children}
          </div>
        </VaulDrawer.Content>
      </ModalPortal>
    );
  }

  const baseClasses = cn(modalContentVariants(), className);

  return (
    <ModalPortal>
      <ModalOverlay className={overlayClassName} />
      <DialogPrimitive.Content className={baseClasses} {...props}>
        <div className="relative flex size-full min-h-0 flex-col">
          <div className="pointer-events-none absolute inset-0 shadow-separator-inset rounded-16" />
          {children}
        </div>
      </DialogPrimitive.Content>
    </ModalPortal>
  );
}

type ModalHeaderProps = ComponentProps<'div'> & {
  title?: string;
  showEscIndicator?: boolean;
  showClose?: boolean;
};

function ModalHeader({
  className,
  title,
  showEscIndicator = true,
  showClose = true,
  children,
  ...props
}: ModalHeaderProps) {
  const {isDesktop} = useModalContext();

  return (
    <div className={cn('flex flex-col w-full shrink-0', className)} {...props}>
      <div className="bg-background-neutral-base flex items-center justify-center gap-20 overflow-clip px-24 py-16 w-full">
        {title ? (
          <Text size="lg" className="flex-1 overflow-ellipsis overflow-hidden whitespace-nowrap">
            {title}
          </Text>
        ) : (
          <div className="flex-1">{children}</div>
        )}
        <div className="flex items-center gap-8">
          {isDesktop && showEscIndicator && <Kbd>Esc</Kbd>}
          {showClose && (
            <ModalClose asChild>
              <Button
                variant="transparent"
                size="xs"
                className="rounded-4 p-2 cursor-pointer bg-transparent border-none text-foreground-neutral-muted hover:text-foreground-neutral-base hover:bg-background-components-hover transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2 w-24 h-24"
              >
                <Icon name="close" />
              </Button>
            </ModalClose>
          )}
        </div>
      </div>
      <div className="bg-border-neutral-strong h-[1px] w-full" />
    </div>
  );
}

function ModalBody({className, children, ...props}: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-background-neutral-base flex min-h-0 flex-1 flex-col items-start overflow-y-auto overflow-x-clip px-24 pb-24 pt-16 w-full',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ModalFooter({className, children, ...props}: ComponentProps<'div'>) {
  return (
    <div className="flex flex-col w-full shrink-0" {...props}>
      <div className="bg-border-neutral-strong h-[1px] w-full" />
      <div className="bg-background-neutral-base flex items-end justify-end gap-20 overflow-clip px-24 py-16 w-full">
        <div className={cn('flex items-center gap-16', className)}>{children}</div>
      </div>
    </div>
  );
}

type ModalTitleProps = ComponentProps<typeof DialogPrimitive.Title>;

function ModalTitle({className, ...props}: ModalTitleProps) {
  const {isDesktop} = useModalContext();

  const titleClassName = cn(
    'font-medium text-lg leading-20 overflow-ellipsis overflow-hidden text-foreground-neutral-base',
    className,
  );

  if (!isDesktop) {
    return <VaulDrawer.Title className={titleClassName} {...props} />;
  }

  return <DialogPrimitive.Title className={titleClassName} {...props} />;
}

type ModalDescriptionProps = ComponentProps<typeof DialogPrimitive.Description>;

function ModalDescription({className, ...props}: ModalDescriptionProps) {
  const {isDesktop} = useModalContext();

  const descClassName = cn('text-sm leading-20 text-foreground-neutral-subtle', className);

  if (!isDesktop) {
    return <VaulDrawer.Description className={descClassName} {...props} />;
  }

  return <DialogPrimitive.Description className={descClassName} {...props} />;
}

type ModalBodyHeaderProps = ComponentProps<'div'> & {
  src: string;
  alt?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
};

function ModalBodyHeader({
  className,
  src,
  alt = '',
  title,
  description,
  children,
  ...props
}: ModalBodyHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-32 items-start max-w-xl', className)} {...props}>
      <img src={src} alt={alt} className="size-116 object-contain" />
      <div className="flex flex-col gap-4 text-center md:text-left!">
        <Header variant="h1" className="text-3xl font-semibold">
          {title}
        </Header>
        {description && (
          <Text size="sm" className="text-foreground-neutral-subtle">
            {description}
          </Text>
        )}
      </div>
      {children}
    </div>
  );
}

export type {
  ModalBodyHeaderProps,
  ModalContentProps,
  ModalDescriptionProps,
  ModalHeaderProps,
  ModalOverlayProps,
  ModalTitleProps,
};
export {
  Modal,
  ModalBody,
  ModalBodyHeader,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalPortal,
  ModalTitle,
  ModalTrigger,
  modalContentVariants,
  modalOverlayVariants,
};
