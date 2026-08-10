import {render, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {codeToHtml} from 'shiki';
import {ThemeProvider} from '../theme/index.js';
import {
  CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE,
  CODE_BLOCK_HIGHLIGHTED_LINE_STYLE,
} from './code-content.js';
import {CodeBlockContent} from './index.js';

vi.mock('shiki', () => ({
  codeToHtml: vi.fn(),
}));

const highlightedHtml = [
  '<pre class="shiki"><code>',
  '<span class="line">one</span>',
  '<span class="line">two</span>',
  '<span class="line">three</span>',
  '</code></pre>',
].join('');

describe('CodeBlockContent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('highlights fallback-rendered lines', () => {
    renderCodeBlockContent({
      code: 'one\ntwo\nthree',
      highlightedLineRange: {startLine: 2, endLine: 3},
    });

    const highlightedLines = document.body.querySelectorAll('.line.highlighted-line');
    expect(highlightedLines).toHaveLength(2);
    expect(highlightedLines[0]?.textContent).toContain('two');
    expect(highlightedLines[1]?.textContent).toContain('three');
    expect(highlightedLines[0]?.classList.contains('text-foreground-highlight-interactive')).toBe(
      false,
    );
  });

  test('does not infer diff styling from YAML list markers', () => {
    renderCodeBlockContent({
      code: 'steps:\n  - uses: actions/checkout@v3',
    });

    const lines = document.body.querySelectorAll('.line');
    expect(lines[1]?.textContent).toContain('- uses: actions/checkout@v3');
    expect(lines[1]?.classList.contains('diff')).toBe(false);
    expect(lines[1]?.classList.contains('remove')).toBe(false);
  });

  test('does not pass the diff transformer for YAML syntax highlighting', async () => {
    const codeToHtmlMock = vi.mocked(codeToHtml);
    codeToHtmlMock.mockResolvedValue(highlightedHtml);

    renderCodeBlockContent({
      code: 'steps:\n  - uses: actions/checkout@v3',
      language: 'yaml',
      syntaxHighlighting: true,
    });

    await waitFor(() => {
      expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
    });

    expect(codeToHtmlMock.mock.calls[0]?.[1].transformers).toBeUndefined();
  });

  test('passes a Shiki transformer that marks explicit diff content', async () => {
    const codeToHtmlMock = vi.mocked(codeToHtml);
    codeToHtmlMock.mockResolvedValue(highlightedHtml);

    renderCodeBlockContent({
      code: '--- a/workflow.yml\n-old value\n+new value\n+++ b/workflow.yml',
      language: 'diff',
      syntaxHighlighting: true,
    });

    await waitFor(() => {
      expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
    });

    const options = codeToHtmlMock.mock.calls[0]?.[1];
    const transformer = options?.transformers?.[0];
    const classes: string[] = [];
    const context = {
      source: '--- a/workflow.yml\n-old value\n+new value\n+++ b/workflow.yml',
      addClassToHast: (_node: unknown, classNames: string[]) => {
        classes.push(...classNames);
      },
    };

    transformer?.line?.call(context as never, {} as never, 2);
    transformer?.line?.call(context as never, {} as never, 3);
    transformer?.line?.call(context as never, {} as never, 1);
    transformer?.line?.call(context as never, {} as never, 4);

    expect(classes).toEqual(['diff', 'remove', 'diff', 'add']);
  });

  test('highlights Shiki-rendered lines without re-highlighting on range-only changes', async () => {
    const codeToHtmlMock = vi.mocked(codeToHtml);
    codeToHtmlMock.mockResolvedValue(highlightedHtml);
    const code = 'one\ntwo\nthree';

    const {rerender} = renderCodeBlockContent({
      code,
      syntaxHighlighting: true,
      highlightedLineRange: {startLine: 2, endLine: 2},
    });

    await waitFor(() => {
      expect(document.body.querySelector('.shiki-override')).not.toBeNull();
    });
    expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.line.highlighted-line')?.textContent).toContain('two');

    rerender(
      <CodeBlockContentHost>
        <CodeBlockContent
          language="text"
          syntaxHighlighting
          highlightedLineRange={{startLine: 3, endLine: 3}}
        >
          {code}
        </CodeBlockContent>
      </CodeBlockContentHost>,
    );

    await waitFor(() => {
      expect(document.body.querySelector('.line.highlighted-line')?.textContent).toContain('three');
    });
    expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
  });

  test('keeps highlighted line backgrounds above the Shiki transparent reset', () => {
    expect(CODE_BLOCK_HIGHLIGHTED_LINE_STYLE).toContain('!bg-background-contrast-highlight');
    expect(CODE_BLOCK_HIGHLIGHTED_LINE_DESCENDANT_STYLE).toContain(
      ':!bg-background-contrast-highlight',
    );
  });
});

describe('CodeBlockContent scroll-into-view', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalMatchMedia = window.matchMedia;
  let scrollCalls: Array<{element: Element; options: ScrollIntoViewOptions | undefined}>;

  beforeEach(() => {
    scrollCalls = [];
    Element.prototype.scrollIntoView = function scrollIntoViewStub(
      this: Element,
      options?: boolean | ScrollIntoViewOptions,
    ) {
      scrollCalls.push({element: this, options: options as ScrollIntoViewOptions | undefined});
    };
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
  });

  test('scrolls the first highlighted line to center when enabled', () => {
    renderCodeBlockContent({
      code: 'one\ntwo\nthree\nfour',
      highlightedLineRange: {startLine: 2, endLine: 3},
      scrollHighlightedIntoView: true,
    });

    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]?.element.textContent).toContain('two');
    expect(scrollCalls[0]?.options).toMatchObject({block: 'center', behavior: 'smooth'});
  });

  test('does not scroll when the affordance is disabled', () => {
    renderCodeBlockContent({
      code: 'one\ntwo\nthree',
      highlightedLineRange: {startLine: 2, endLine: 2},
    });

    expect(scrollCalls).toHaveLength(0);
  });

  test('does not scroll when there is no highlighted range', () => {
    renderCodeBlockContent({code: 'one\ntwo\nthree', scrollHighlightedIntoView: true});

    expect(scrollCalls).toHaveLength(0);
  });

  test('uses an instant scroll under reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as typeof window.matchMedia;

    renderCodeBlockContent({
      code: 'one\ntwo\nthree',
      highlightedLineRange: {startLine: 2, endLine: 2},
      scrollHighlightedIntoView: true,
    });

    expect(scrollCalls[0]?.options).toMatchObject({block: 'center', behavior: 'auto'});
  });
});

function renderCodeBlockContent({
  code,
  language,
  syntaxHighlighting,
  highlightedLineRange,
  scrollHighlightedIntoView,
}: {
  code: string;
  language?: string | undefined;
  syntaxHighlighting?: boolean | undefined;
  highlightedLineRange?: Parameters<typeof CodeBlockContent>[0]['highlightedLineRange'];
  scrollHighlightedIntoView?: boolean | undefined;
}) {
  return render(
    <CodeBlockContentHost>
      <CodeBlockContent
        language={language ?? 'text'}
        highlightedLineRange={highlightedLineRange}
        {...(syntaxHighlighting === undefined ? {} : {syntaxHighlighting})}
        {...(scrollHighlightedIntoView === undefined ? {} : {scrollHighlightedIntoView})}
      >
        {code}
      </CodeBlockContent>
    </CodeBlockContentHost>,
  );
}

function CodeBlockContentHost({children}: {children: ReactNode}) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="code-block-content-test-theme">
      {children}
    </ThemeProvider>
  );
}
