import {cva, type VariantProps} from 'class-variance-authority';
import type {ReactNode} from 'react';
import {Icon} from '#components/icon/icon.js';
import {cn} from '#utils/cn.js';

const toastCustomVariants = cva('group relative flex items-start gap-8', {
  variants: {
    variant: {
      default: 'text-tag-neutral-icon',
      info: 'text-tag-neutral-icon',
      success: 'text-tag-success-icon',
      warning: 'text-tag-warning-icon',
      error: 'text-tag-error-icon',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastCustomProps = VariantProps<typeof toastCustomVariants> & {
  title?: string;
  description?: string;
  content?: string;
  actions?: ToastAction[];
  onClose?: () => void;
  className?: string;
};

function getDefaultIcon(variant: ToastCustomProps['variant'] = 'default'): ReactNode {
  switch (variant) {
    case 'info':
      return <Icon name="info" size={20} />;
    case 'success':
      return <Icon name="checkCircleSolid" size={20} />;
    case 'warning':
      return <Icon name="info" size={20} />;
    case 'error':
      return <Icon name="xCircleSolid" size={20} />;
    default:
      return <Icon name="info" size={20} />;
  }
}

export function ToastCustom({
  variant = 'default',
  title,
  description,
  content,
  actions,
  onClose,
  className,
}: ToastCustomProps) {
  const hasTitle = Boolean(title);
  const hasDescription = Boolean(description);
  const hasContent = Boolean(content);
  const hasActions = Boolean(actions && actions.length > 0);
  const isSimple = hasContent && !hasTitle && !hasDescription;

  return (
    <div data-slot="toast-custom" className={cn(toastCustomVariants({variant}), className)}>
      <div className="w-20 h-20 rounded-full flex items-start justify-center shrink-0 pt-1">
        {getDefaultIcon(variant)}
      </div>

      <div className="flex-1 min-w-0">
        {hasTitle && (
          <div
            data-slot="toast-custom-title"
            className="font-medium text-sm leading-20 text-foreground-neutral-base mb-4"
          >
            {title}
          </div>
        )}
        {hasDescription && (
          <div
            data-slot="toast-custom-description"
            className="text-xs leading-20 text-foreground-neutral-muted mb-8"
          >
            {description}
          </div>
        )}
        {isSimple ? (
          <div className="flex items-center justify-between gap-16 min-w-400 mr-30">
            <div
              data-slot="toast-custom-content"
              className="text-sm leading-20 text-foreground-neutral-base"
            >
              {content}
            </div>
            {hasActions && (
              <div data-slot="toast-custom-actions" className="flex items-center gap-16">
                {actions?.map((action) => (
                  <button
                    key={action.label}
                    data-slot="toast-custom-action"
                    type="button"
                    onClick={action.onClick}
                    className="bg-transparent border-none p-0 cursor-pointer text-xs font-medium leading-20 text-foreground-neutral-base hover:text-foreground-neutral-subtle transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {hasContent && !hasTitle && (
              <div
                data-slot="toast-custom-content"
                className="text-sm leading-20 text-foreground-neutral-base mb-8"
              >
                {content}
              </div>
            )}
            {hasActions && (
              <div data-slot="toast-custom-actions" className="flex items-center gap-16 mt-8">
                {actions?.map((action) => (
                  <button
                    key={action.label}
                    data-slot="toast-custom-action"
                    type="button"
                    onClick={action.onClick}
                    className="bg-transparent border-none p-0 cursor-pointer text-xs font-medium leading-20 text-foreground-neutral-base hover:text-foreground-neutral-subtle transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {onClose && (
        <button
          data-slot="toast-custom-close"
          type="button"
          onClick={onClose}
          className="absolute cursor-pointer -top-2 -right-2 rounded-4 p-4 bg-transparent border-none text-foreground-neutral-muted hover:text-foreground-neutral-base hover:bg-background-components-hover transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2 shrink-0"
          aria-label="Close"
        >
          <Icon name="close" className="w-16 h-16" />
        </button>
      )}
    </div>
  );
}
