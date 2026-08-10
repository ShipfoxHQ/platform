'use client';

import type {ComponentProps, MouseEvent} from 'react';
import {useEffect, useRef, useState} from 'react';
import {useCopyToClipboard} from '#hooks/useCopyToClipboard.js';
import {cn} from '#utils/cn.js';
import {Icon} from '../icon/index.js';

type CodeCopyButtonProps = Omit<ComponentProps<'button'>, 'onCopy'> & {
  content: string;
  onCopy?: ((content: string) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
  timeout?: number;
  children?: React.ReactNode;
};

export function CodeCopyButton({
  content,
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  onClick,
  ...props
}: CodeCopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const {copy} = useCopyToClipboard({
    text: content,
    onCopy: () => {
      setIsCopied(true);
      onCopy?.(content);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setIsCopied(false);
      }, timeout);
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    try {
      await copy();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Failed to copy'));
    }
  };

  return (
    <button
      {...props}
      type="button"
      aria-label={isCopied ? 'Copied' : 'Copy to clipboard'}
      onClick={handleClick}
      className={cn(
        'flex shrink-0 cursor-pointer items-center justify-center rounded-6 bg-transparent text-foreground-contrast-secondary transition-colors hover:bg-background-components-hover hover:text-foreground-contrast-primary active:bg-background-components-pressed p-4 outline-none focus-visible:shadow-button-neutral-focus',
        className,
      )}
    >
      {children ?? <Icon name={isCopied ? 'check' : 'copy'} className="size-16" />}
    </button>
  );
}
