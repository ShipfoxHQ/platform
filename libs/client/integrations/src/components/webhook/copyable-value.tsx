import {Button} from '@shipfox/react-ui/button';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import {useEffect, useRef, useState} from 'react';

interface CopyableValueProps {
  label: string;
  value: string;
  note?: ReactNode;
  className?: string;
}

export function CopyableValue({label, value, note, className}: CopyableValueProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {copy} = useCopyToClipboard({
    text: value,
    onCopy: () => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await copy();
    } catch {
      toast.error('Could not copy.');
    }
  }

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-inline', className)}>
      <div className="flex min-w-0 items-center gap-inline">
        <Code
          as="span"
          variant="paragraph"
          className="min-w-0 flex-1 break-all rounded-4 border border-border-neutral-base bg-background-components-base p-tight text-foreground-neutral-base"
        >
          {value}
        </Code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconLeft={copied ? 'check' : 'copy'}
          aria-label={`Copy ${label}`}
          onClick={() => {
            void handleCopy();
          }}
        >
          Copy
        </Button>
      </div>
      {note ? (
        <Text size="sm" className="text-foreground-neutral-muted">
          {note}
        </Text>
      ) : null}
    </div>
  );
}
