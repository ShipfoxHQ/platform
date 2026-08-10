'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import {cva, type VariantProps} from 'class-variance-authority';
import type {ComponentProps, ReactNode} from 'react';
import {getInitial, getPlaceholderImageUrl} from '#utils/avatar.js';
import {cn} from '#utils/cn.js';
import {Icon, type IconName} from '../icon/icon.js';

export const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden bg-background-button-neutral-default text-foreground-neutral-base ring-1 ring-border-neutral-base-component ring-offset-1 ring-offset-background-neutral-base shadow-button-neutral',
  {
    variants: {
      radius: {
        full: 'rounded-full',
        rounded: 'rounded-4',
      },
      size: {
        '3xs': 'size-[18px]',
        '2xs': 'size-[20px]',
        xs: 'size-[24px]',
        sm: 'size-[28px]',
        md: 'size-[32px]',
        lg: 'size-[36px]',
        xl: 'size-[40px]',
        '2xl': 'size-[80px]',
        '3xl': 'size-[120px]',
      },
    },
    defaultVariants: {
      radius: 'full',
      size: 'md',
    },
  },
);

const avatarInnerVariants = cva('flex h-full w-full items-center justify-center', {
  variants: {
    size: {
      '3xs': 'text-[10px] leading-[10px]',
      '2xs': 'text-[11px] leading-[11px]',
      xs: 'text-xs leading-4',
      sm: 'text-xs leading-5',
      md: 'text-sm leading-5',
      lg: 'text-sm leading-5',
      xl: 'text-base leading-6',
      '2xl': 'text-2xl leading-8',
      '3xl': 'text-4xl leading-[56px]',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export type AvatarContent = 'letters' | 'logo' | 'logoPlaceholder' | 'image' | 'upload';

const UPLOAD_ICON_SIZE_MAP: Record<
  NonNullable<VariantProps<typeof avatarVariants>['size']>,
  string
> = {
  '3xs': 'size-[10px]',
  '2xs': 'size-[12px]',
  xs: 'size-[14px]',
  sm: 'size-[16px]',
  md: 'size-[18px]',
  lg: 'size-[20px]',
  xl: 'size-[24px]',
  '2xl': 'size-[40px]',
  '3xl': 'size-[60px]',
} as const;

function AvatarRoot({
  className,
  radius,
  size,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(avatarVariants({radius, size}), className)}
      {...props}
    />
  );
}

function AvatarImage({className, ...props}: ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  );
}

function AvatarFallback({className, ...props}: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-name"
      className={cn('flex size-full items-center justify-center', className)}
      {...props}
    />
  );
}

export type AvatarProps = ComponentProps<typeof AvatarPrimitive.Root> &
  VariantProps<typeof avatarVariants> & {
    content?: AvatarContent;
    src?: string;
    alt?: string;
    fallback?: string;
    animateOnHover?: boolean;
    logoName?: IconName;
    logoClassName?: string;
  };

export function Avatar({
  className,
  radius,
  size = 'md',
  content = 'letters',
  src,
  alt,
  fallback,
  animateOnHover = false,
  logoName = 'shipfox',
  logoClassName,
  ...props
}: AvatarProps) {
  const innerClassName =
    'flex h-full w-full items-center justify-center rounded-inherit relative bg-background-components-base text-foreground-neutral-subtle';

  const renderContent = (): ReactNode => {
    if (content === 'image') {
      const imageSrc = src || getPlaceholderImageUrl(fallback);
      return (
        <>
          <AvatarImage
            src={imageSrc}
            alt={alt || 'Avatar image'}
            className="object-scale-down rounded-inherit"
          />
          <AvatarFallback className={innerClassName}>
            <div
              className={cn(
                'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
                avatarInnerVariants({size}),
              )}
            >
              <span className="font-medium">{getInitial(fallback)}</span>
            </div>
          </AvatarFallback>
        </>
      );
    }

    if (content === 'logo') {
      return (
        <AvatarFallback className={cn(innerClassName, logoClassName ?? 'p-[15%]')}>
          <Icon name={logoName} className="h-full w-full" />
        </AvatarFallback>
      );
    }

    if (content === 'logoPlaceholder') {
      return (
        <AvatarFallback className={cn(innerClassName, logoClassName ?? 'p-[15%]')}>
          <Icon
            name={logoName}
            color="var(--foreground-neutral-subtle, #a1a1aa)"
            className="h-full w-full opacity-50"
          />
        </AvatarFallback>
      );
    }

    if (content === 'letters') {
      return (
        <AvatarFallback className={innerClassName}>
          <div
            className={cn(
              'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
              avatarInnerVariants({size}),
            )}
          >
            <span className="font-medium">{getInitial(fallback)}</span>
          </div>
        </AvatarFallback>
      );
    }

    if (content === 'upload') {
      const iconSizeClass = UPLOAD_ICON_SIZE_MAP[size as keyof typeof UPLOAD_ICON_SIZE_MAP];
      return (
        <AvatarFallback className={innerClassName}>
          <Icon name="imageAdd" className={cn('text-foreground-neutral-subtle', iconSizeClass)} />
        </AvatarFallback>
      );
    }

    return null;
  };

  return (
    <AvatarRoot
      className={cn(
        animateOnHover ? 'hover:-translate-y-8 transition-transform duration-300 ease-out' : '',
        className,
      )}
      radius={radius}
      size={size}
      {...props}
    >
      {renderContent()}
    </AvatarRoot>
  );
}

export {AvatarFallback, AvatarImage, AvatarRoot};
