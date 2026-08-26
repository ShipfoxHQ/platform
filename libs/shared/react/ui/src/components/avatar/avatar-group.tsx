'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {cva, type VariantProps} from 'class-variance-authority';
import {
  Children,
  type ComponentProps,
  cloneElement,
  type ReactElement,
  type ReactNode,
  useMemo,
} from 'react';
import {cn} from '#utils/cn.js';
import {TooltipContent, TooltipProvider, TooltipTrigger} from '../tooltip/tooltip.js';

const avatarGroupVariants = cva('flex items-start', {
  variants: {
    size: {
      '3xs': '-space-x-4',
      '2xs': '-space-x-4',
      xs: '-space-x-4',
      sm: '-space-x-6',
      md: '-space-x-6',
      lg: '-space-x-6',
      xl: '-space-x-6',
      '2xl': '-space-x-12',
      '3xl': '-space-x-12',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

const avatarGroupOverflowVariants = cva(
  'flex shrink-0 items-center justify-center rounded-full bg-background-components-base text-foreground-neutral-subtle font-medium ring-1 ring-border-neutral-base-component ring-offset-1 ring-offset-background-neutral-base shadow-button-neutral',
  {
    variants: {
      size: {
        '3xs': 'size-[18px] text-[10px] leading-[10px]',
        '2xs': 'size-[20px] text-[11px] leading-[11px]',
        xs: 'size-[24px] text-xs leading-4',
        sm: 'size-[28px] text-xs leading-5',
        md: 'size-[32px] text-sm leading-5',
        lg: 'size-[36px] text-sm leading-5',
        xl: 'size-[40px] text-base leading-6',
        '2xl': 'size-[80px] text-2xl leading-8',
        '3xl': 'size-[120px] text-4xl leading-[56px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

type TooltipContentProps = ComponentProps<typeof TooltipContent>;

type AvatarContainerProps = {
  children: ReactNode;
  zIndex: number;
  tooltipContent?: ReactNode;
  tooltipProps?: Partial<TooltipContentProps>;
  animateOnHover?: boolean;
};

function AvatarContainer({
  children,
  zIndex,
  tooltipContent,
  tooltipProps,
  animateOnHover = false,
}: AvatarContainerProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipTrigger asChild>
        <div
          data-slot="avatar-container"
          className={cn(
            'relative',
            animateOnHover && 'transition-transform duration-300 ease-in-out hover:-translate-y-4',
          )}
          style={{zIndex}}
        >
          {children}
        </div>
      </TooltipTrigger>
      {tooltipContent && (
        <AvatarGroupTooltip {...tooltipProps}>{tooltipContent}</AvatarGroupTooltip>
      )}
    </TooltipPrimitive.Root>
  );
}

function getTooltipContent(children: ReactNode): ReactNode | null {
  const tooltip = Children.toArray(children).find(
    (child) =>
      typeof child === 'object' &&
      child !== null &&
      'type' in child &&
      child.type === AvatarGroupTooltip,
  ) as ReactElement<ComponentProps<typeof AvatarGroupTooltip>> | undefined;

  return tooltip?.props.children || null;
}

type AvatarGroupTooltipProps = TooltipContentProps;

function AvatarGroupTooltip(props: AvatarGroupTooltipProps) {
  return <TooltipContent {...props} />;
}

type AvatarGroupProps = ComponentProps<'div'> &
  VariantProps<typeof avatarGroupVariants> & {
    children: ReactElement[];
    maxVisible?: number;
    animateOnHover?: boolean;
    tooltipProps?: Partial<TooltipContentProps>;
  };

export function AvatarGroup({
  className,
  size = 'md',
  children,
  maxVisible,
  animateOnHover = false,
  tooltipProps = {side: 'top', sideOffset: 8},
  ...props
}: AvatarGroupProps) {
  const normalizedSize = size ?? 'md';

  const childrenArray = Children.toArray(children) as ReactElement[];

  const {visibleCount, visibleAvatars, overflowCount} = useMemo(() => {
    const count =
      maxVisible !== undefined ? Math.min(maxVisible, childrenArray.length) : childrenArray.length;
    return {
      visibleCount: count,
      visibleAvatars: childrenArray.slice(0, count),
      overflowCount: childrenArray.length - count,
    };
  }, [childrenArray, maxVisible]);

  return (
    <TooltipProvider>
      <div
        className={cn(avatarGroupVariants({size: normalizedSize}), className)}
        data-slot="avatar-group"
        {...props}
      >
        {visibleAvatars.map((child, index) => {
          const zIndex = index + 1;
          const childProps = 'props' in child ? (child.props as {children?: ReactNode}) : {};
          const tooltipContent = getTooltipContent(childProps.children);

          return (
            <AvatarContainer
              key={child.key || index}
              zIndex={zIndex}
              tooltipContent={tooltipContent}
              tooltipProps={tooltipProps}
              animateOnHover={animateOnHover}
            >
              {cloneElement(child, {
                ...childProps,
                children: tooltipContent ? undefined : childProps.children,
              } as Partial<typeof childProps>)}
            </AvatarContainer>
          );
        })}
        {overflowCount > 0 && (
          <div
            className={cn(
              'relative',
              avatarGroupOverflowVariants({size: normalizedSize}),
              'rounded-full',
            )}
            style={{zIndex: visibleCount + 1}}
          >
            +{overflowCount}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export {AvatarGroupTooltip, type AvatarGroupTooltipProps};
