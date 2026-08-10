'use client';

import type {ComponentProps, HTMLAttributes, ReactNode} from 'react';
import {createContext, useCallback, useContext, useRef, useState} from 'react';
import {useResolvedTheme} from '#hooks/useResolvedTheme.js';
import {useShikiHighlight} from '#hooks/useShikiHighlight.js';
import {useShikiStyleInjection} from '#hooks/useShikiStyleInjection.js';
import {cn} from '#utils/cn.js';
import {CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE, CodeContent} from './code-content.js';
import {CodeCopyButton} from './code-copy-button.js';
import {type CodeBlockHighlightedLineRange, isCodeBlockLineHighlighted} from './line-highlight.js';
import {useScrollHighlightedLineIntoView} from './use-scroll-highlighted-line.js';

export type BundledLanguage = string;

/**
 * One file in a `CodeBlock`. `filename` is the selection identity used to match
 * the active tab and resolve the copied snippet, so it must be unique within a
 * single `CodeBlock`. `language` is only the Shiki highlighting language.
 */
export type CodeBlockData = {
  language: string;
  filename: string;
  code: string;
};

type CodeBlockContextType = {
  value: string | undefined;
  onValueChange: ((value: string) => void) | undefined;
  data: CodeBlockData[];
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  value: undefined,
  onValueChange: undefined,
  data: [],
});

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  data: CodeBlockData[];
};

export function CodeBlock({
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  defaultValue,
  className,
  data,
  ...props
}: CodeBlockProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? data[0]?.filename ?? '');
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

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
    <CodeBlockContext.Provider value={{value, onValueChange, data}}>
      <div
        className={cn(
          'size-full overflow-hidden rounded-12 bg-background-contrast-base shadow-button-neutral',
          className,
        )}
        {...props}
      />
    </CodeBlockContext.Provider>
  );
}

export type CodeBlockHeaderProps = HTMLAttributes<HTMLDivElement>;

export function CodeBlockHeader({className, ...props}: CodeBlockHeaderProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-row items-center gap-12 overflow-clip bg-background-contrast-base px-16 py-8',
        className,
      )}
      {...props}
    />
  );
}

export type CodeBlockFilesProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children: (item: CodeBlockData) => ReactNode;
};

export function CodeBlockFiles({className, children, ...props}: CodeBlockFilesProps) {
  const {data} = useContext(CodeBlockContext);

  return (
    <div className={cn('flex grow flex-row items-center gap-12', className)} {...props}>
      {data.map((item) => (
        <div key={item.filename}>{children(item)}</div>
      ))}
    </div>
  );
}

export type CodeBlockFilenameProps = HTMLAttributes<HTMLDivElement> & {
  value?: string;
};

export function CodeBlockFilename({className, value, children, ...props}: CodeBlockFilenameProps) {
  const {value: activeValue} = useContext(CodeBlockContext);

  if (value !== activeValue) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-20 font-code text-foreground-contrast-secondary',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type CodeBlockCopyButtonProps = Omit<ComponentProps<'button'>, 'onCopy'> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function CodeBlockCopyButton({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) {
  const {data, value} = useContext(CodeBlockContext);
  const code = data.find((item) => item.filename === value)?.code ?? '';

  return (
    <CodeCopyButton
      {...props}
      content={code}
      onCopy={() => onCopy?.()}
      onError={onError}
      timeout={timeout}
      className={className}
    >
      {children}
    </CodeCopyButton>
  );
}

type CodeBlockFallbackProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  highlightedLineRange?: CodeBlockHighlightedLineRange | null | undefined;
  scrollHighlightedIntoView?: boolean | undefined;
  children: string;
};

function CodeBlockFallback({
  children,
  className,
  highlightedLineRange,
  scrollHighlightedIntoView = false,
  ...props
}: CodeBlockFallbackProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const lines = children?.toString().split('\n') ?? [];

  useScrollHighlightedLineIntoView(rootRef, {
    enabled: scrollHighlightedIntoView,
    highlightedLineRange,
  });

  return (
    <pre
      ref={(node) => {
        rootRef.current = node;
      }}
      className={cn('w-full font-code', className)}
      {...(props as HTMLAttributes<HTMLPreElement>)}
    >
      <code>
        {lines.map((line, index) => {
          const key = `${index}-${line}`;

          return (
            <span
              className={cn(
                'line',
                isCodeBlockLineHighlighted(index + 1, highlightedLineRange) && 'highlighted-line',
              )}
              key={key}
            >
              {line}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export type CodeBlockBodyProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  children: (item: CodeBlockData) => ReactNode;
};

export function CodeBlockBody({children, ...props}: CodeBlockBodyProps) {
  const {data} = useContext(CodeBlockContext);

  return (
    <div {...props}>
      {data.map((item) => (
        <div key={item.filename}>{children(item)}</div>
      ))}
    </div>
  );
}

export type CodeBlockItemProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
  lineNumbers?: boolean;
};

export type CodeBlockSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  lineNumbers?: boolean;
};

export function CodeBlockSurface({
  children,
  lineNumbers = true,
  className,
  ...props
}: CodeBlockSurfaceProps) {
  return (
    <div
      data-slot="code-block-surface"
      className={cn(
        'flex min-h-0 min-w-0 flex-1 shrink-0 rounded-8 border border-border-contrast-bottom bg-background-contrast-subtle font-code',
        '[&_pre]:py-12 [&_pre]:font-code',
        '[&_code]:w-full [&_code]:grid [&_code]:overflow-x-auto [&_code]:bg-transparent [&_code]:font-code [&_code]:text-xs [&_code]:leading-20 [&_code]:text-foreground-contrast-primary',
        '[&_.line]:block [&_.line]:px-12 [&_.line]:w-full [&_.line]:relative [&_.line]:font-code [&_.line]:min-h-[1.25rem]',
        lineNumbers &&
          '[&_code]:[counter-reset:line] [&_code]:[counter-increment:line_0] [&_.line]:before:content-[counter(line)] [&_.line]:before:inline-block [&_.line]:before:[counter-increment:line] [&_.line]:before:w-16 [&_.line]:before:mr-16 [&_.line]:before:text-xs [&_.line]:before:text-right [&_.line]:before:text-foreground-contrast-secondary [&_.line]:before:font-code [&_.line]:before:select-none',
        '[&_.line.diff]:after:absolute [&_.line.diff]:after:left-0 [&_.line.diff]:after:top-0 [&_.line.diff]:after:bottom-0 [&_.line.diff]:after:w-1',
        '[&_.line.diff.add]:bg-tag-success-bg [&_.line.diff.add]:text-tag-success-text [&_.line.diff.add]:after:bg-tag-success-icon',
        '[&_.line.diff.remove]:bg-tag-error-bg [&_.line.diff.remove]:text-tag-error-text [&_.line.diff.remove]:after:bg-tag-error-icon',
        CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CodeBlockItem({
  children,
  lineNumbers = true,
  className,
  value,
  ...props
}: CodeBlockItemProps) {
  const {value: activeValue} = useContext(CodeBlockContext);

  if (value !== activeValue) {
    return null;
  }

  return (
    <div
      className={cn('flex w-full shrink-0 items-start overflow-clip px-4 pb-4 pt-0', className)}
      {...props}
    >
      <CodeBlockSurface lineNumbers={lineNumbers}>{children}</CodeBlockSurface>
    </div>
  );
}

export type CodeBlockContentProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  themes?: {
    light: string;
    dark: string;
  };
  language?: BundledLanguage;
  syntaxHighlighting?: boolean;
  highlightedLineRange?: CodeBlockHighlightedLineRange | null | undefined;
  scrollHighlightedIntoView?: boolean | undefined;
  children: string;
};

export function CodeBlockContent({
  children,
  themes = {
    light: 'vitesse-dark',
    dark: 'vitesse-dark',
  },
  language = 'typescript',
  syntaxHighlighting = false,
  highlightedLineRange,
  scrollHighlightedIntoView = false,
  ...props
}: CodeBlockContentProps) {
  const resolvedTheme = useResolvedTheme();

  useShikiStyleInjection(syntaxHighlighting);

  const {highlightedCode, isLoading} = useShikiHighlight({
    code: children,
    lang: language,
    themes,
    resolvedTheme,
    syntaxHighlighting,
  });

  if (!syntaxHighlighting || isLoading) {
    return (
      <CodeBlockFallback
        highlightedLineRange={highlightedLineRange}
        scrollHighlightedIntoView={scrollHighlightedIntoView}
        {...props}
      >
        {children}
      </CodeBlockFallback>
    );
  }

  return (
    <CodeContent
      code={children}
      highlightedCode={highlightedCode}
      isLoading={isLoading}
      syntaxHighlighting={syntaxHighlighting}
      highlightedLineRange={highlightedLineRange}
      scrollHighlightedIntoView={scrollHighlightedIntoView}
      {...props}
    />
  );
}
