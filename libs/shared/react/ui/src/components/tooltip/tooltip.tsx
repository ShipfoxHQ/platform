import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {cva, type VariantProps} from 'class-variance-authority';
import {motion, type Transition} from 'framer-motion';
import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';

const tooltipContentVariants = cva(
  'rounded-8 px-8 py-4 text-xs font-medium leading-20 z-50 w-fit text-balance shadow-tooltip',
  {
    variants: {
      variant: {
        default: 'bg-background-components-base text-foreground-neutral-base',
        inverted: 'bg-background-button-inverted-default text-foreground-contrast-primary',
        muted: 'bg-background-neutral-subtle text-foreground-neutral-muted',
      },
      size: {
        sm: 'px-6 py-2 text-xs',
        md: 'px-8 py-4 text-xs',
        lg: 'px-10 py-6 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

function TooltipProvider({
  delayDuration = 0,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({...props}: ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({...props}: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

const defaultTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 17,
};

type TooltipContentProps = ComponentProps<typeof TooltipPrimitive.Content> &
  VariantProps<typeof tooltipContentVariants> & {
    animated?: boolean;
    transition?: Transition;
  };

function TooltipContent({
  className,
  sideOffset = 8,
  children,
  variant,
  size,
  animated = true,
  transition = defaultTransition,
  ...props
}: TooltipContentProps) {
  if (animated) {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          data-slot="tooltip-content"
          sideOffset={sideOffset}
          asChild
          {...props}
        >
          <motion.div
            className={cn(tooltipContentVariants({variant, size, className}))}
            initial={{opacity: 0, scale: 0.95}}
            animate={{opacity: 1, scale: 1}}
            exit={{opacity: 0, scale: 0.95}}
            transition={transition}
          >
            {children}
          </motion.div>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    );
  }

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(tooltipContentVariants({variant, size, className}))}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export type {TooltipContentProps};
export {
  defaultTransition,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  tooltipContentVariants,
};
