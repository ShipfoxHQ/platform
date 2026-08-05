import {ThemeProvider} from '@shipfox/react-ui/theme';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactNode} from 'react';
import {AnnotationCard, type AnnotationCardProps} from './annotation-card.js';

const styles = ['default', 'info', 'success', 'warning', 'error'] as const;
const stylesWithDefaultGlyph = ['info', 'success', 'warning', 'error'] as const;
/** Markdown link syntax that reached the DOM as text, which means the source was cut mid-link. */
const UNPARSED_LINK_PATTERN = /^\[documentation\]/u;
const OPEN_DOCUMENTATION_PATTERN = /Open documentation/;
const PREFIX_PATTERN = /prefix/u;
const DOCUMENTATION_PATTERN = /documentation/u;

describe('AnnotationCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each(styles)('renders %s annotations as callouts', (style) => {
    const {container} = renderAnnotationCard({style, body: `**${style}** body`});

    expect(container.querySelector('[data-slot="callout"]')).not.toBeNull();
  });

  test.each(stylesWithDefaultGlyph)('renders the default %s glyph', (style) => {
    const {container} = renderAnnotationCard({style, body: 'Body'});

    expect(container.querySelector('[data-slot="callout-icon"]')).not.toBeNull();
  });

  test('renders default style with the side-line treatment', () => {
    const {container} = renderAnnotationCard({style: 'default', body: 'Body'});

    expect(container.querySelector('[data-slot="callout-icon"]')).toBeNull();
    expect(container.querySelector('[data-slot="callout-line"]')).not.toBeNull();
  });

  test('renders sanitized Markdown', () => {
    const {container} = renderAnnotationCard({
      style: 'warning',
      body: '[safe](https://example.com) <img src=x onerror=alert(1)> <script>alert(1)</script>',
    });

    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  test('sets dir auto on rendered Markdown', () => {
    const {container} = renderAnnotationCard({style: 'info', body: 'שלום'});

    expect(container.querySelector('[dir="auto"]')).not.toBeNull();
  });

  test('renders nothing for empty bodies', () => {
    const {container} = renderAnnotationCard({style: 'error', body: ' \n '});

    expect(container.firstChild).toBeNull();
  });

  test('renders the context as a heading at the level the caller asks for', () => {
    renderAnnotationCard({style: 'error', body: 'Body', title: 'smoke check', titleAs: 'h3'});

    expect(screen.getByRole('heading', {level: 3, name: 'smoke check'})).toBeInTheDocument();
  });

  test('keeps the header when the body is empty', () => {
    renderAnnotationCard({style: 'info', body: '', title: 'deploy'});

    expect(screen.getByRole('heading', {name: 'deploy'})).toBeInTheDocument();
  });

  test('leaves a body that fits unbounded and undisclosed', () => {
    stubRenderedBodyHeight(40);
    const {container} = renderAnnotationCard({style: 'info', body: 'Short', maxBodyHeight: 320});

    expect(screen.queryByRole('button', {name: 'Show more'})).not.toBeInTheDocument();
    expect(container.querySelector('[style*="max-height"]')).toBeNull();
  });

  test('never clips a body that overruns the budget by less than the tolerance', () => {
    // Without a disclosure to open, a silent clip would hide content with nothing to reveal it.
    stubRenderedBodyHeight(324);
    const {container} = renderAnnotationCard({
      style: 'info',
      body: 'Just over',
      maxBodyHeight: 320,
    });

    expect(screen.queryByRole('button', {name: 'Show more'})).not.toBeInTheDocument();
    expect(container.querySelector('[style*="max-height"]')).toBeNull();
  });

  test('parses only a preview of a very large body until it is expanded', async () => {
    const user = userEvent.setup();
    stubRenderedBodyHeight(5_000);
    // Clipping with CSS bounds the layout but not the parse: the whole megabyte would still be
    // turned into DOM behind `overflow: hidden`.
    // Lines are padded so the 4,000-character source budget, not the line count, is what
    // bounds the preview: ~45 characters per line puts roughly 90 of the 700 on screen.
    const lineCount = 700;
    const body = Array.from(
      {length: lineCount},
      (_unused, index) => `- line ${index} ${'detail '.repeat(5)}`,
    ).join('\n');
    renderAnnotationCard({style: 'error', body, maxBodyHeight: 320});

    const items = () => screen.getAllByRole('listitem').length;
    expect(items()).toBeLessThan(150);
    expect(screen.queryByText(new RegExp(`line ${lineCount - 1}\\b`, 'u'))).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Show more'}));

    expect(items()).toBe(lineCount);
    expect(screen.getByText(new RegExp(`line ${lineCount - 1}\\b`, 'u'))).toBeInTheDocument();
  });

  test('cuts the preview at a line boundary', () => {
    stubRenderedBodyHeight(5_000);
    // A mid-line cut can split a link and render the fragment as literal text. An unterminated
    // fence needs no handling: CommonMark closes one at end of document.
    const line = `[documentation](https://example.com/${'path/'.repeat(8)}) trailing words here`;
    renderAnnotationCard({
      style: 'info',
      body: Array.from({length: 200}, () => line).join('\n\n'),
      maxBodyHeight: 320,
    });

    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', expect.stringContaining('example.com'));
    }
    expect(screen.queryByText(UNPARSED_LINK_PATTERN)).not.toBeInTheDocument();
  });

  test('does not parse a partial first line in an oversized single-line body', async () => {
    const user = userEvent.setup();
    stubRenderedBodyHeight(5_000);
    const body = `${'prefix '.repeat(570)}[documentation](https://example.com/${'path/'.repeat(300)})`;
    renderAnnotationCard({style: 'info', body, maxBodyHeight: 320});

    expect(screen.queryByText(PREFIX_PATTERN)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'documentation'})).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Show more'}));

    expect(screen.getByRole('link', {name: DOCUMENTATION_PATTERN})).toHaveAttribute(
      'href',
      expect.stringContaining('example.com'),
    );
  });

  test('discloses a body that arrives after the card mounted empty', async () => {
    stubRenderedBodyHeight(5_000);
    const {rerender} = renderAnnotationCard({style: 'warning', body: '', title: 'deploy'});

    expect(screen.queryByRole('button', {name: 'Show more'})).not.toBeInTheDocument();

    rerender(
      <AnnotationCardTestHost>
        <AnnotationCard style="warning" body="Appended during the step" title="deploy" />
      </AnnotationCardTestHost>,
    );

    // The observer only exists once there is a node to observe, so an empty-to-content
    // transition has to reinstall it or the body clips with nothing to open it.
    expect(await screen.findByRole('button', {name: 'Show more'})).toBeInTheDocument();
  });

  test('clamps a body taller than the budget behind a disclosure', async () => {
    const user = userEvent.setup();
    stubRenderedBodyHeight(5_000);
    const {container} = renderAnnotationCard({style: 'error', body: 'Tall', maxBodyHeight: 320});

    const showMore = screen.getByRole('button', {name: 'Show more'});
    expect(showMore).toHaveAttribute('aria-expanded', 'false');
    const clamped = container.querySelector<HTMLElement>(`#${CSS.escape(bodyId(showMore))}`);
    expect(clamped).toHaveStyle({maxHeight: '320px'});

    await user.click(showMore);

    expect(screen.getByRole('button', {name: 'Show less'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(clamped).not.toHaveStyle({maxHeight: '320px'});
  });

  test('reveals a clipped body when focus enters one of its links', async () => {
    const user = userEvent.setup();
    stubRenderedBodyHeight(5_000);
    const {container} = renderAnnotationCard({
      style: 'info',
      body: '[Open documentation](https://example.com)',
      maxBodyHeight: 320,
    });

    await user.tab();

    expect(screen.getByRole('link', {name: OPEN_DOCUMENTATION_PATTERN})).toHaveFocus();
    expect(screen.getByRole('button', {name: 'Show less'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(container.querySelector('[style*="max-height"]')).toBeNull();
  });
});

/** jsdom performs no layout, so the measured content height is stubbed for the clamp tests. */
function stubRenderedBodyHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(height);
}

function bodyId(showMore: HTMLElement): string {
  const id = showMore.getAttribute('aria-controls');
  if (!id) throw new Error('Show more is not associated with a body.');
  return id;
}

function renderAnnotationCard({
  style,
  body,
  ...props
}: {style: (typeof styles)[number]; body: string} & Partial<AnnotationCardProps>) {
  return render(
    <AnnotationCardTestHost>
      <AnnotationCard style={style} body={body} {...props} />
    </AnnotationCardTestHost>,
  );
}

function AnnotationCardTestHost({children}: {children: ReactNode}) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="annotation-card-test-theme">
      {children}
    </ThemeProvider>
  );
}
