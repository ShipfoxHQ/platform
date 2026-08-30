'use client';

import * as Tabs from '@radix-ui/react-tabs';
import type {ComponentProps} from 'react';
import {useCallback, useMemo, useState} from 'react';
import {useResolvedTheme} from '#hooks/useResolvedTheme.js';
import {useShikiHighlightMultiple} from '#hooks/useShikiHighlight.js';
import {useShikiStyleInjection} from '#hooks/useShikiStyleInjection.js';
import {cn} from '#utils/cn.js';
import {CodeContent} from './code-content.js';
import {CodeCopyButton} from './code-copy-button.js';

export type CodeTabsProps = Omit<ComponentProps<typeof Tabs.Root>, 'children' | 'onCopy'> & {
  codes: Record<string, string>;
  lang?: string;
  themes?: {
    light: string;
    dark: string;
  };
  copyButton?: boolean;
  onCopy?: ((content: string) => void) | undefined;
  syntaxHighlighting?: boolean;
  lineNumbers?: boolean;
};

function CodeTabsContent({
  codes,
  lang = 'bash',
  themes = {
    light: 'vitesse-dark',
    dark: 'vitesse-dark',
  },
  copyButton = true,
  onCopy,
  syntaxHighlighting = false,
  lineNumbers = false,
  activeValue,
}: {
  codes: Record<string, string>;
  lang?: string;
  themes?: {light: string; dark: string};
  copyButton?: boolean;
  onCopy?: ((content: string) => void) | undefined;
  syntaxHighlighting?: boolean;
  lineNumbers?: boolean;
  activeValue: string;
}) {
  const resolvedTheme = useResolvedTheme();
  const codesKeys = useMemo(() => Object.keys(codes), [codes]);

  useShikiStyleInjection(syntaxHighlighting);

  const {highlightedCodes, isLoading} = useShikiHighlightMultiple({
    codes,
    lang,
    themes,
    resolvedTheme,
    syntaxHighlighting,
  });

  const activeCode = codes[activeValue] ?? '';

  return (
    <>
      <Tabs.List
        className={cn(
          'relative flex w-full flex-row items-center justify-between gap-12 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-background-contrast-base px-16 py-8',
          'border-b border-border-contrast-bottom',
          'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px',
          'after:bg-border-contrast-top',
          'after:shadow-separator-inset',
        )}
      >
        <div className="flex flex-row gap-12">
          {codesKeys.map((code) => (
            <Tabs.Trigger
              key={code}
              value={code}
              className={cn(
                'relative px-8 py-4 text-xs leading-20 font-medium text-foreground-contrast-secondary transition-colors',
                'outline-none focus-visible:shadow-border-interactive-with-active focus-visible:rounded-2',
                'data-[state=active]:text-foreground-contrast-primary',
                'hover:text-foreground-contrast-primary',
                'data-[state=active]:z-10',
                'data-[state=active]:after:absolute data-[state=active]:after:-bottom-9 data-[state=active]:after:left-0 data-[state=active]:after:right-0',
                'data-[state=active]:after:h-2 data-[state=active]:after:bg-foreground-contrast-primary',
              )}
            >
              {code}
            </Tabs.Trigger>
          ))}
        </div>

        {copyButton && <CodeCopyButton content={activeCode} onCopy={onCopy} className="shrink-0" />}
      </Tabs.List>
      <div className="w-full px-4 pb-4 pt-8">
        {Object.entries(codes).map(([code, rawCode]) => (
          <Tabs.Content key={code} value={code} className="w-full">
            <div
              className={cn(
                'flex min-h-0 min-w-0 w-full shrink-0 rounded-8 border border-border-contrast-bottom bg-background-contrast-subtle font-code',
                '[&_pre]:py-12 [&_pre]:font-code',
                '[&_pre]:m-0 [&_pre]:px-0 [&_pre]:bg-transparent',
                '[&_code]:w-full [&_code]:overflow-x-auto [&_code]:bg-transparent [&_code]:font-code [&_code]:text-xs [&_code]:leading-20 [&_code]:text-foreground-contrast-primary',
                lineNumbers &&
                  '[&_code]:grid [&_code]:[counter-reset:line] [&_code]:[counter-increment:line_0] [&_.line]:before:content-[counter(line)] [&_.line]:before:inline-block [&_.line]:before:[counter-increment:line] [&_.line]:before:w-16 [&_.line]:before:mr-16 [&_.line]:before:text-xs [&_.line]:before:text-right [&_.line]:before:text-foreground-contrast-secondary [&_.line]:before:font-code [&_.line]:before:select-none',
                '[&_.line]:block [&_.line]:px-12 [&_.line]:w-full [&_.line]:relative [&_.line]:font-code [&_.line]:min-h-[1.25rem]',
              )}
            >
              <CodeContent
                code={rawCode}
                highlightedCode={highlightedCodes[code]}
                isLoading={isLoading}
                syntaxHighlighting={syntaxHighlighting}
                lineNumbers={lineNumbers}
              />
            </div>
          </Tabs.Content>
        ))}
      </div>
    </>
  );
}

export function CodeTabs({
  codes,
  lang = 'bash',
  themes = {
    light: 'vitesse-dark',
    dark: 'vitesse-dark',
  },
  className,
  defaultValue,
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  copyButton = true,
  onCopy,
  syntaxHighlighting = false,
  lineNumbers = false,
  ...props
}: CodeTabsProps) {
  const firstKey = useMemo(() => Object.keys(codes)[0] ?? '', [codes]);
  const [internalValue, setInternalValue] = useState(defaultValue ?? firstKey);
  const isControlled = controlledValue !== undefined;
  // When uncontrolled, the selected tab can disappear if `codes` changes
  // (dynamic/async sources). Fall back to the first key so a tab is always active.
  let value = firstKey;
  if (isControlled) value = controlledValue;
  else if (Object.hasOwn(codes, internalValue)) value = internalValue;

  const onValueChange = useCallback(
    (next: string) => {
      if (!isControlled) {
        setInternalValue(next);
      }
      controlledOnValueChange?.(next);
    },
    [isControlled, controlledOnValueChange],
  );

  return (
    <Tabs.Root
      className={cn(
        'w-full overflow-hidden rounded-12 bg-background-contrast-base shadow-button-neutral',
        className,
      )}
      value={value}
      onValueChange={onValueChange}
      {...props}
    >
      <CodeTabsContent
        codes={codes}
        lang={lang}
        themes={themes}
        copyButton={copyButton}
        onCopy={onCopy}
        syntaxHighlighting={syntaxHighlighting}
        lineNumbers={lineNumbers}
        activeValue={value}
      />
    </Tabs.Root>
  );
}
