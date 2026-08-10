import {type HTMLAttributes, useRef} from 'react';
import {cn} from '#utils/cn.js';
import {
  type CodeBlockHighlightedLineRange,
  highlightCodeBlockHtmlLines,
  isCodeBlockLineHighlighted,
} from './line-highlight.js';
import {useScrollHighlightedLineIntoView} from './use-scroll-highlighted-line.js';

export const CODE_BLOCK_HIGHLIGHTED_LINE_STYLE =
  '!bg-background-contrast-highlight shadow-[inset_2px_0_0_color-mix(in_srgb,var(--border-highlights-interactive)_65%,transparent)]';

export const CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE =
  '[&_.line.highlighted-line]:!bg-background-contrast-highlight [&_.line.highlighted-line]:shadow-[inset_2px_0_0_color-mix(in_srgb,var(--border-highlights-interactive)_65%,transparent)]';

type CodeContentProps = HTMLAttributes<HTMLElement> & {
  code: string;
  highlightedCode?: string | undefined;
  isLoading: boolean;
  syntaxHighlighting: boolean;
  lineNumbers?: boolean;
  highlightedLineRange?: CodeBlockHighlightedLineRange | null | undefined;
  scrollHighlightedIntoView?: boolean | undefined;
};

export function CodeContent({
  code,
  highlightedCode,
  isLoading,
  syntaxHighlighting,
  lineNumbers = false,
  highlightedLineRange,
  scrollHighlightedIntoView = false,
  className,
  ...props
}: CodeContentProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const shouldShowHighlighted = syntaxHighlighting && !isLoading && highlightedCode;

  useScrollHighlightedLineIntoView(rootRef, {
    enabled: scrollHighlightedIntoView,
    highlightedLineRange,
  });

  if (shouldShowHighlighted) {
    const codeHtml = highlightCodeBlockHtmlLines(highlightedCode, highlightedLineRange);

    return (
      <div
        ref={(node) => {
          rootRef.current = node;
        }}
        {...props}
        className={cn(
          'shiki-override w-full overflow-x-auto font-code [&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent [&_pre]:font-code [&_code]:font-code [&_code]:bg-transparent [&_code]:text-xs [&_code]:leading-20 [&_code]:text-foreground-contrast-primary [&_code]:grid',
          lineNumbers &&
            '[&_code]:[counter-reset:line] [&_code]:[counter-increment:line_0] [&_.line]:before:content-[counter(line)] [&_.line]:before:inline-block [&_.line]:before:[counter-increment:line] [&_.line]:before:w-16 [&_.line]:before:mr-16 [&_.line]:before:text-xs [&_.line]:before:text-right [&_.line]:before:text-foreground-contrast-secondary [&_.line]:before:font-code [&_.line]:before:select-none',
          '[&_.line]:block [&_.line]:px-12 [&_.line]:w-full [&_.line]:relative [&_.line]:font-code [&_.line]:text-xs [&_.line]:leading-20 [&_.line]:min-h-[1.25rem]',
          CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE,
          className,
        )}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: only Shiki-generated markup is rendered here.
        dangerouslySetInnerHTML={{__html: codeHtml}}
      />
    );
  }

  const lines = code.split('\n');

  return (
    <pre
      ref={(node) => {
        rootRef.current = node;
      }}
      className={cn('m-0 p-0 bg-transparent font-code', className)}
      {...props}
    >
      <code
        className={cn(
          'w-full overflow-x-auto bg-transparent font-code text-xs leading-20 text-foreground-contrast-primary',
          'grid',
          lineNumbers &&
            '[counter-reset:line] [counter-increment:line_0] [&_.line]:before:content-[counter(line)] [&_.line]:before:inline-block [&_.line]:before:[counter-increment:line] [&_.line]:before:w-16 [&_.line]:before:mr-16 [&_.line]:before:text-xs [&_.line]:before:text-right [&_.line]:before:text-foreground-contrast-secondary [&_.line]:before:font-code [&_.line]:before:select-none',
        )}
      >
        {lines.map((line, index) => {
          const key = `${index}-${line}`;
          return (
            <span
              className={cn(
                'line px-12 w-full relative font-code text-xs leading-20 min-h-[1.25rem]',
                isCodeBlockLineHighlighted(index + 1, highlightedLineRange) &&
                  `highlighted-line ${CODE_BLOCK_HIGHLIGHTED_LINE_STYLE}`,
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
