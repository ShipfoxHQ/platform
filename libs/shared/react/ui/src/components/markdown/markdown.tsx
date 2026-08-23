'use client';

import {Component, memo, type ReactElement, type ReactNode} from 'react';
import type {Components} from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, {defaultSchema} from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import {CodeBlockContent, CodeBlockSurface} from '#components/code-block/index.js';
import {Icon} from '#components/icon/index.js';
import {cn} from '#utils/cn.js';

const CODE_FENCE_MAX_BYTES = 20 * 1024;
const CODE_FENCE_MAX_LINES = 500;
const TRAILING_NEWLINE_PATTERN = /\n$/;
const LANGUAGE_CLASS_PATTERN = /language-([^\s]+)/;
const calloutCodeLanguageFallback = 'text';

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter((tagName) => tagName !== 'img'),
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https'],
  },
};

type MarkdownHeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
type MarkdownHeadingComponent = NonNullable<Components['h1']>;

const headingClassNames = {
  1: 'mb-8 text-lg font-medium text-foreground-neutral-base',
  2: 'mb-8 text-md font-medium text-foreground-neutral-base',
  3: 'mb-8 text-sm font-medium text-foreground-neutral-base',
  4: 'mb-8 text-sm font-medium text-foreground-neutral-base',
} as const;

function createMarkdownHeading(
  tag: MarkdownHeadingTag,
  baseClassName: string,
): MarkdownHeadingComponent {
  const Heading = tag;
  return ({className, node: _node, ...props}) => (
    <Heading className={cn(baseClassName, className)} {...props} />
  );
}

const markdownHeadingComponents = {
  h1: createMarkdownHeading('h1', headingClassNames[1]),
  h2: createMarkdownHeading('h2', headingClassNames[2]),
  h3: createMarkdownHeading('h3', headingClassNames[3]),
  h4: createMarkdownHeading('h4', headingClassNames[4]),
} satisfies Components;

const nestedMarkdownHeadingComponents = {
  h1: createMarkdownHeading('h2', headingClassNames[1]),
  h2: createMarkdownHeading('h3', headingClassNames[2]),
  h3: createMarkdownHeading('h4', headingClassNames[3]),
  h4: createMarkdownHeading('h5', headingClassNames[4]),
  h5: createMarkdownHeading('h6', headingClassNames[4]),
  h6: createMarkdownHeading('h6', headingClassNames[4]),
} satisfies Components;

const markdownComponents = {
  ...markdownHeadingComponents,
  p: ({className, node: _node, ...props}) => (
    <p
      className={cn('mb-8 text-sm leading-20 text-foreground-neutral-base', className)}
      {...props}
    />
  ),
  ul: ({className, node: _node, ...props}) => (
    <ul
      className={cn('mb-8 list-disc pl-16 text-sm text-foreground-neutral-base', className)}
      {...props}
    />
  ),
  ol: ({className, node: _node, ...props}) => (
    <ol
      className={cn('mb-8 list-decimal pl-16 text-sm text-foreground-neutral-base', className)}
      {...props}
    />
  ),
  li: ({className, node: _node, ...props}) => (
    <li className={cn('mb-4 pl-4', className)} {...props} />
  ),
  blockquote: ({className, node: _node, ...props}) => (
    <blockquote
      className={cn(
        'mb-8 border-l-2 border-border-neutral-strong pl-12 text-sm text-foreground-neutral-subtle',
        className,
      )}
      {...props}
    />
  ),
  // Sized to content, not to the container: a two-column table stretched to full width puts a
  // cell 700px from its row header. The scroll container still absorbs a table too wide to fit.
  table: ({className, node: _node, ...props}) => (
    <div className="mb-8 overflow-x-auto">
      <table
        className={cn(
          'w-auto border-collapse border border-border-neutral-base text-sm tabular-nums',
          className,
        )}
        {...props}
      />
    </div>
  ),
  th: ({className, node: _node, ...props}) => (
    <th
      className={cn(
        'border border-border-neutral-base px-8 py-4 text-left font-medium text-foreground-neutral-base',
        className,
      )}
      {...props}
    />
  ),
  td: ({className, node: _node, ...props}) => (
    <td
      className={cn(
        'border border-border-neutral-base px-8 py-4 text-foreground-neutral-base',
        className,
      )}
      {...props}
    />
  ),
  hr: ({className, node: _node, ...props}) => (
    <hr className={cn('mb-8 border-border-neutral-base', className)} {...props} />
  ),
  a: ({className, href, children, node: _node, ...props}) => {
    if (!isSafeHref(href)) {
      return <span className={className}>{children}</span>;
    }

    return (
      <a
        className={cn(
          'inline-flex items-baseline gap-2 text-foreground-highlight-interactive underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2',
          className,
        )}
        href={href}
        rel="noopener noreferrer nofollow"
        target="_blank"
        {...props}
      >
        <span>{children}</span>
        <Icon
          name="externalLink"
          size={14}
          aria-hidden="true"
          className="inline-block translate-y-2"
        />
        <span className="sr-only">(opens in new tab)</span>
      </a>
    );
  },
  img: () => null,
  pre: ({children}) => <>{children}</>,
  code: ({className, children, node: _node, ...props}) => {
    const code = childrenToString(children).replace(TRAILING_NEWLINE_PATTERN, '');
    const language = className?.match(LANGUAGE_CLASS_PATTERN)?.[1];
    const isBlockCode = Boolean(language) || code.includes('\n');

    if (!isBlockCode) {
      return (
        <code
          className={cn(
            'rounded-2 bg-background-components-base px-4 py-2 font-code text-xs text-foreground-neutral-base',
            className,
          )}
          {...props}
        >
          {children}
        </code>
      );
    }

    const lineCount = code.split('\n').length;
    const codeLanguage = language ?? calloutCodeLanguageFallback;
    const syntaxHighlighting =
      Boolean(language) &&
      new TextEncoder().encode(code).byteLength <= CODE_FENCE_MAX_BYTES &&
      lineCount <= CODE_FENCE_MAX_LINES;

    return (
      <div className="mb-8 overflow-x-auto">
        <CodeBlockSurface lineNumbers={lineCount > 1}>
          <CodeBlockContent language={codeLanguage} syntaxHighlighting={syntaxHighlighting}>
            {code}
          </CodeBlockContent>
        </CodeBlockSurface>
      </div>
    );
  },
} satisfies Components;

const nestedMarkdownComponents = {
  ...markdownComponents,
  ...nestedMarkdownHeadingComponents,
} satisfies Components;

type MarkdownProps = {
  children: string;
  className?: string | undefined;
  headingLevelOffset?: 0 | 1 | undefined;
};

function MarkdownImpl({children, className, headingLevelOffset = 0}: MarkdownProps) {
  if (!children.trim()) return null;

  return (
    <MarkdownRenderGuard body={children}>
      <div className={cn('min-w-0 [overflow-wrap:anywhere]', className)} dir="auto">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
          components={headingLevelOffset === 1 ? nestedMarkdownComponents : markdownComponents}
        >
          {children}
        </ReactMarkdown>
      </div>
    </MarkdownRenderGuard>
  );
}

type MarkdownRenderGuardProps = {
  body: string;
  children: ReactNode;
};

type MarkdownRenderGuardState = {
  hasError: boolean;
};

class MarkdownRenderGuard extends Component<MarkdownRenderGuardProps, MarkdownRenderGuardState> {
  override state: MarkdownRenderGuardState = {hasError: false};

  static getDerivedStateFromError(): MarkdownRenderGuardState {
    return {hasError: true};
  }

  override componentDidUpdate(prevProps: MarkdownRenderGuardProps) {
    if (this.state.hasError && prevProps.body !== this.props.body) {
      this.setState({hasError: false});
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <pre
          className="min-w-0 whitespace-pre-wrap rounded-8 bg-background-components-base p-12 font-code text-xs leading-20 text-foreground-neutral-base [overflow-wrap:anywhere]"
          dir="auto"
        >
          {this.props.body}
        </pre>
      );
    }

    return this.props.children;
  }
}

function isSafeHref(href: string | undefined): href is string {
  if (!href) return false;

  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function childrenToString(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToString).join('');
  if (isReactElementWithChildren(children)) return childrenToString(children.props.children);
  return '';
}

function isReactElementWithChildren(
  value: ReactNode,
): value is ReactElement<{children?: ReactNode}> {
  return typeof value === 'object' && value !== null && 'props' in value;
}

const Markdown = memo(MarkdownImpl);

export {Markdown, MarkdownRenderGuard};
