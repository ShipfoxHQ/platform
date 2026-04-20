import type {ComponentProps} from 'react';
import {cn} from '#utils/cn.js';
import {Header, Text} from '../typography/index.js';

export interface CardProps extends ComponentProps<'div'> {}

export function Card({className, children, ...props}: CardProps) {
  return (
    <div
      className={cn(
        'p-12 rounded-8 bg-background-neutral-base border border-border-neutral-base flex flex-col gap-16',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends ComponentProps<'div'> {}

export function CardHeader({className, children, ...props}: CardHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)} {...props}>
      {children}
    </div>
  );
}

export interface CardTitleProps extends ComponentProps<typeof Header> {}

export function CardTitle({className, children, variant = 'h3', ...props}: CardTitleProps) {
  return (
    <Header variant={variant} className={cn('text-foreground-neutral-base', className)} {...props}>
      {children}
    </Header>
  );
}

export interface CardDescriptionProps extends ComponentProps<typeof Text> {}

export function CardDescription({
  className,
  children,
  size = 'sm',
  ...props
}: CardDescriptionProps) {
  return (
    <Text size={size} className={cn('text-foreground-neutral-muted', className)} {...props}>
      {children}
    </Text>
  );
}

export interface CardActionProps extends ComponentProps<'div'> {}

export function CardAction({className, children, ...props}: CardActionProps) {
  return (
    <div className={cn('ml-auto', className)} {...props}>
      {children}
    </div>
  );
}

export interface CardContentProps extends ComponentProps<'div'> {}

export function CardContent({className, children, ...props}: CardContentProps) {
  return (
    <div className={cn('flex-1', className)} {...props}>
      {children}
    </div>
  );
}

export interface CardFooterProps extends ComponentProps<'div'> {}

export function CardFooter({className, children, ...props}: CardFooterProps) {
  return (
    <div className={cn('flex items-center gap-8', className)} {...props}>
      {children}
    </div>
  );
}
