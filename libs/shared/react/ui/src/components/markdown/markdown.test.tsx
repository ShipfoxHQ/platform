import {render, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {codeToHtml} from 'shiki';
import {ThemeProvider} from '../theme/index.js';
import {Markdown, MarkdownRenderGuard} from './markdown.js';

const DOCS_LINK_NAME = /docs/i;

vi.mock('shiki', () => ({
  codeToHtml: vi
    .fn()
    .mockResolvedValue(
      '<pre class="shiki"><code><span class="line">const value = true;</span></code></pre>',
    ),
}));

describe('Markdown', () => {
  beforeEach(() => {
    vi.mocked(codeToHtml).mockClear();
  });

  test('sanitizes hostile input', () => {
    const {container} = renderMarkdown(`
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)></svg>
<iframe srcdoc="<script>alert(1)</script>"></iframe>
<object data="javascript:alert(1)"></object>
[javascript](javascript:alert(1))
[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)
`);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('object')).toBeNull();
    expect(container.querySelector('[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('[href^="data:"]')).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.startsWith('on')).toBe(false);
      }
    }
    expect(container).toMatchSnapshot();
  });

  test('renders nothing for empty bodies', () => {
    const {container} = renderMarkdown(' \n\t ');

    expect(container.firstChild).toBeNull();
  });

  test('renders GFM tables, lists, and safe external links', () => {
    const {container, getByRole, getByText} = renderMarkdown(`
- one
- two

| name | count |
| --- | ---: |
| jobs | 12 |

[docs](https://example.com/docs)
`);

    const table = getByRole('table');
    expect(table.classList.contains('w-auto')).toBe(true);
    expect(table.classList.contains('min-w-full')).toBe(false);
    expect(getByText('one')).not.toBeNull();
    const link = getByRole('link', {name: DOCS_LINK_NAME});
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(container.textContent).toContain('(opens in new tab)');
    expect(container.querySelector('[node]')).toBeNull();
  });

  test('adds line-number styling for multi-line fences', async () => {
    const {container} = renderMarkdown('```ts\nconst a = 1;\nconst b = 2;\n```');

    await waitFor(() => {
      expect(container.querySelector('.shiki-override')).not.toBeNull();
    });
    expect(container.querySelector('[class*="counter-reset:line"]')).not.toBeNull();
  });

  test('omits line-number styling for single-line fences', async () => {
    const {container} = renderMarkdown('```ts\nconst a = 1;\n```');

    await waitFor(() => {
      expect(container.querySelector('.shiki-override')).not.toBeNull();
    });
    expect(container.querySelector('[class*="counter-reset:line"]')).toBeNull();
  });

  test('renders oversized fences without Shiki highlighting', () => {
    const oversizedFence = `\`\`\`ts\n${'const value = true;\n'.repeat(501)}\`\`\``;

    const {container} = renderMarkdown(oversizedFence);

    expect(codeToHtml).not.toHaveBeenCalled();
    expect(container.querySelector('.shiki-override')).toBeNull();
    expect(container.textContent).toContain('const value = true;');
  });

  test('renders fences without a language as block code', () => {
    const {container} = renderMarkdown('```\nplain\ntext\n```');

    expect(codeToHtml).not.toHaveBeenCalled();
    expect(container.querySelector('[data-slot="code-block-surface"]')).not.toBeNull();
    expect(container.querySelector('[class*="counter-reset:line"]')).not.toBeNull();
    expect(container.textContent).toContain('plain');
    expect(container.textContent).toContain('text');
  });

  test('sets dir auto on the wrapper', () => {
    const {container} = renderMarkdown('שלום');

    expect(container.querySelector('[dir="auto"]')).not.toBeNull();
  });

  test('falls back to escaped plain text when rendering throws', () => {
    const body = '<script>alert(1)</script>';

    const {container} = render(
      <MarkdownRenderGuard body={body}>
        <ThrowingChild />
      </MarkdownRenderGuard>,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain(body);
  });
});

function renderMarkdown(body: string) {
  return render(
    <MarkdownTestHost>
      <Markdown>{body}</Markdown>
    </MarkdownTestHost>,
  );
}

function MarkdownTestHost({children}: {children: ReactNode}) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="markdown-test-theme">
      {children}
    </ThemeProvider>
  );
}

function ThrowingChild(): ReactNode {
  throw new Error('forced markdown render failure');
}
