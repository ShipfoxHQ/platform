import {AlertTriangle, CheckCircle2, Info, Loader2, XCircle} from 'lucide-react';
import {
  Toaster as SonnerToaster,
  type ToasterProps as SonnerToasterProps,
  toast as sonnerToast,
} from 'sonner';
import {useTheme} from '#hooks/useTheme.js';

type ToasterProps = Omit<SonnerToasterProps, 'theme'>;

function Toaster({...props}: ToasterProps) {
  const {theme} = useTheme();

  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background-components-base group-[.toaster]:text-foreground-neutral-base group-[.toaster]:border group-[.toaster]:border-border-neutral-base group-[.toaster]:shadow-tooltip rounded-8 p-8',
          description: 'group-[.toast]:text-foreground-neutral-muted text-xs leading-20 mt-4',
          actionButton:
            'group-[.toast]:bg-background-button-neutral-default group-[.toast]:text-foreground-neutral-base group-[.toast]:hover:bg-background-button-neutral-hover rounded-6 px-8 py-4 text-xs font-medium',
          cancelButton:
            'group-[.toast]:bg-background-button-transparent-default group-[.toast]:text-foreground-neutral-base group-[.toast]:hover:bg-background-button-transparent-hover rounded-6 px-8 py-4 text-xs font-medium',
        },
      }}
      icons={{
        success: <CheckCircle2 className="size-20 text-tag-success-icon" />,
        info: <Info className="size-20 text-tag-blue-icon" />,
        warning: <AlertTriangle className="size-20 text-tag-warning-icon" />,
        error: <XCircle className="size-20 text-tag-error-icon" />,
        loading: <Loader2 className="size-20 text-tag-neutral-icon animate-spin" />,
      }}
      {...props}
    />
  );
}

export {sonnerToast as toast, Toaster, type ToasterProps};
