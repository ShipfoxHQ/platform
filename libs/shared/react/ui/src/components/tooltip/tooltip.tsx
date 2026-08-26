'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {cva, type VariantProps} from 'class-variance-authority';
import {type HTMLMotionProps, motion, type Transition, useReducedMotion} from 'framer-motion';
import {type ComponentProps, createContext, forwardRef, useContext} from 'react';
import {cn} from '#utils/cn.js';

const defaultDelayDuration = 200;
const defaultSkipDelayDuration = 300;
const TooltipProviderContext = createContext(false);

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

/** Shares the standard cold-open delay and warm window across descendant tooltips. */
function TooltipProvider({
  delayDuration = defaultDelayDuration,
  skipDelayDuration = defaultSkipDelayDuration,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipProviderContext.Provider value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </TooltipProviderContext.Provider>
  );
}

/** Uses the nearest provider, or supplies the standard timing when rendered alone. */
function Tooltip({...props}: ComponentProps<typeof TooltipPrimitive.Root>) {
  const hasProvider = useContext(TooltipProviderContext);
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;

  return hasProvider ? root : <TooltipProvider>{root}</TooltipProvider>;
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

type AnimatedTooltipContentProps = Omit<HTMLMotionProps<'div'>, 'transition'> & {
  'data-state'?: 'closed' | 'delayed-open' | 'instant-open';
  transition: Transition;
};

const AnimatedTooltipContent = forwardRef<HTMLDivElement, AnimatedTooltipContentProps>(
  function AnimatedTooltipContent({'data-state': state, transition, ...props}, ref) {
    const reducedMotion = useReducedMotion();
    const shouldAnimate = !reducedMotion && state !== 'instant-open';

    return (
      <motion.div
        ref={ref}
        data-state={state}
        {...props}
        initial={shouldAnimate ? {opacity: 0, scale: 0.95} : false}
        animate={{opacity: 1, scale: 1}}
        {...(shouldAnimate ? {exit: {opacity: 0, scale: 0.95}} : {})}
        transition={shouldAnimate ? transition : {duration: 0}}
      />
    );
  },
);

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
          <AnimatedTooltipContent
            className={cn(tooltipContentVariants({variant, size, className}))}
            transition={transition}
          >
            {children}
          </AnimatedTooltipContent>
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
