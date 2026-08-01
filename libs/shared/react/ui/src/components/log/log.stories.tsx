import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {useArgs, useRef, useState} from 'storybook/preview-api';
import {Badge} from '#components/badge/index.js';
import {Code} from '#components/typography/index.js';
import {toggleTimestampUnit} from './format-timestamp.js';
import {LogContent} from './log-content.js';
import {LogHeader} from './log-header.js';
import {LogRow, type LogRowTone} from './log-row.js';
import {LogRows} from './log-rows.js';
import {LogWrapToggle} from './log-wrap-toggle.js';

const meta = {
  title: 'Components/Log',
  component: LogRows,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    timestamps: {control: 'inline-radio', options: ['off', 'rel', 'abs']},
    wrap: {control: 'boolean'},
    showLineNumbers: {control: 'boolean'},
  },
  args: {
    timestamps: 'off',
    wrap: false,
    showLineNumbers: true,
  },
} satisfies Meta<typeof LogRows>;

export default meta;

type Story = StoryObj<typeof meta>;

const origin = new Date('2026-06-22T14:32:00.000Z');
const at = (offsetSeconds: number) => new Date(origin.getTime() + offsetSeconds * 1000);
const ESC = String.fromCharCode(27);
const ansiBuild = `${ESC}[32m✓${ESC}[0m built ${ESC}[34m1284${ESC}[0m modules · ${ESC}[1;31m1 error${ESC}[0m`;

const Glyph = ({className, children}: {className: string; children: string}) => (
  <span className={className}>{children}</span>
);

const Section = ({label, children}: {label: string; children: ReactNode}) => (
  <div className="flex flex-col gap-8">
    <Code variant="label" className="text-foreground-neutral-subtle">
      {label}
    </Code>
    {children}
  </div>
);

/**
 * Controls-driven surface: flip the args to explore timestamps, wrap, and the
 * gutter. The click- and hook-driven behaviors (switch timestamps, per-line
 * wrap) live in the `Interactive` story, since they own state the args cannot.
 */
export const Playground: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogRows {...args} timestampOrigin={origin} className="max-h-360">
        <LogRow lineNumber={34} timestamp={at(9)}>
          <LogContent variant="code">transforming (1284) src/index.tsx</LogContent>
        </LogRow>
        <LogRow lineNumber={35} timestamp={at(9.4)}>
          <LogContent variant="code" ansi>
            {ansiBuild}
          </LogContent>
        </LogRow>
        <LogRow lineNumber={36} timestamp={at(9.7)} tone="warning">
          <LogContent variant="code">WARN deprecated glob@7: upgrade to glob@10</LogContent>
        </LogRow>
        <LogRow lineNumber={37} timestamp={at(9.9)} tone="error">
          <LogContent variant="code">
            ERROR TypeError: Cannot read properties of undefined (reading "id") at withRetry
            (src/api/retry.ts:42:18)
          </LogContent>
        </LogRow>
        <LogRow lineNumber={38} timestamp={at(10.1)} tone="accent">
          <LogHeader end={<>$0.084 · 2.1s</>}>
            <Glyph className="text-purple-500 dark:text-purple-400">{'✦'}</Glyph>
            <Badge variant="feature">Assistant</Badge>
          </LogHeader>
          <LogContent>Patched the off-by-one in withRetry().</LogContent>
        </LogRow>
        <LogRow lineNumber={39} timestamp={at(10.3)} selected>
          <LogContent variant="code">dist/assets/index-a3f9b1c2.js</LogContent>
        </LogRow>
        <LogRow lineNumber={40} timestamp={at(10.5)} indent={1}>
          <LogContent variant="code">
            <Glyph className="font-bold text-green-500 dark:text-green-400">{'✓ '}</Glyph>
            1284 modules transformed
          </LogContent>
        </LogRow>
        <LogRow lineNumber={41} timestamp={at(10.7)}>
          <LogContent variant="code" className="text-foreground-neutral-muted">
            built in 412ms
          </LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

/**
 * The gutter. `lineNumber` numbers a row; `null` leaves a blank cell so a marker
 * still aligns. `showLineNumbers={false}` drops the column entirely.
 */
export const LineNumbers: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-16">
      <Section label="showLineNumbers (default) · lineNumber={null} leaves a blank cell">
        <LogRows>
          <LogRow lineNumber={1}>
            <LogContent variant="code">resolving dependencies</LogContent>
          </LogRow>
          <LogRow lineNumber={2}>
            <LogContent variant="code">linking 318 packages</LogContent>
          </LogRow>
          <LogRow lineNumber={null}>
            <LogContent variant="code" className="text-foreground-neutral-muted">
              lineNumber=null: a marker row keeps the gutter blank
            </LogContent>
          </LogRow>
          <LogRow lineNumber={3}>
            <LogContent variant="code">done</LogContent>
          </LogRow>
        </LogRows>
      </Section>
      <Section label="showLineNumbers={false}">
        <LogRows showLineNumbers={false}>
          <LogRow lineNumber={1}>
            <LogContent variant="code">no gutter column</LogContent>
          </LogRow>
          <LogRow lineNumber={2}>
            <LogContent variant="code">content starts at the left edge</LogContent>
          </LogRow>
        </LogRows>
      </Section>
    </div>
  ),
};

export const Timestamps: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-16 md:grid-cols-3">
      {(['off', 'rel', 'abs'] as const).map((mode) => (
        <Section key={mode} label={`timestamps="${mode}"`}>
          <LogRows timestamps={mode} timestampOrigin={origin}>
            <LogRow lineNumber={17} timestamp={at(0.412)}>
              <LogContent variant="code">resolving dependencies</LogContent>
            </LogRow>
            <LogRow lineNumber={18} timestamp={at(0.53)}>
              <LogContent variant="code">linking 318 packages</LogContent>
            </LogRow>
            <LogRow lineNumber={19} timestamp={at(65.3)}>
              <LogContent variant="code">done</LogContent>
            </LogRow>
          </LogRows>
        </Section>
      ))}
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        {(['default', 'info', 'accent', 'success', 'warning', 'error'] as const).map(
          (tone, index) => (
            <LogRow key={tone} lineNumber={index + 1} tone={tone}>
              <LogContent variant="code">tone="{tone}"</LogContent>
            </LogRow>
          ),
        )}
      </LogRows>
    </div>
  ),
};

/**
 * `selected` marks the cursor row for keyboard traversal. Its brand-orange bar
 * is the one orange in the system, so it always wins over a row's `tone`.
 */
export const Selected: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogRow lineNumber={11}>
          <LogContent variant="code">a normal row</LogContent>
        </LogRow>
        <LogRow lineNumber={12} selected>
          <LogContent variant="code">selected: the cursor row (j / k)</LogContent>
        </LogRow>
        <LogRow lineNumber={13}>
          <LogContent variant="code">another normal row</LogContent>
        </LogRow>
        <LogRow lineNumber={14} tone="error" selected>
          <LogContent variant="code">selected keeps the orange bar over a tone tint</LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

export const Indent: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogRow lineNumber={1} indent={0}>
          <LogContent variant="code">depth 0: build</LogContent>
        </LogRow>
        <LogRow lineNumber={2} indent={1}>
          <LogContent variant="code">depth 1: typecheck</LogContent>
        </LogRow>
        <LogRow lineNumber={3} indent={2}>
          <LogContent variant="code">depth 2: transform module</LogContent>
        </LogRow>
        <LogRow lineNumber={4} indent={3}>
          <LogContent variant="code">depth 3: emit chunk</LogContent>
        </LogRow>
        <LogRow lineNumber={5} indent={1}>
          <LogContent variant="code">depth 1: bundle</LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

/**
 * `wrap` chooses between soft-wrap and horizontal scroll. Both states make a
 * long line legible without hiding it: wrapped continuations hang-indent under
 * the first line; a non-wrapping line scrolls and fades at the truncated edge.
 * A line that fits is untouched either way.
 */
export const Wrapping: Story = {
  render: () => {
    const long =
      'ERROR  TypeError: Cannot read properties of undefined (reading "id") at withRetry (src/api/retry.ts:42:18) at async runStep (src/runner/step.ts:118:7)';
    return (
      <div className="flex max-w-md flex-col gap-16">
        <Section label="wrap=false: the line scrolls; a right fade marks the truncation">
          <LogRows wrap={false}>
            <LogRow lineNumber={120} tone="error">
              <LogContent variant="code">{long}</LogContent>
            </LogRow>
            <LogRow lineNumber={121}>
              <LogContent variant="code">resuming after the failure</LogContent>
            </LogRow>
          </LogRows>
        </Section>
        <Section label="wrap=true: continuation lines hang-indent under the first">
          <LogRows wrap>
            <LogRow lineNumber={120} tone="error">
              <LogContent variant="code">{long}</LogContent>
            </LogRow>
            <LogRow lineNumber={121}>
              <LogContent variant="code">resuming after the failure</LogContent>
            </LogRow>
          </LogRows>
        </Section>
      </div>
    );
  },
};

/**
 * Controls linked to the component: the Storybook Controls panel drives the
 * globals (`timestamps`, `wrap`, `showLineNumbers`) straight through `{...args}`.
 *
 * Per-line wrap is layered on top and stays off the text so copy/paste is
 * untouched: the chevron is the explicit toggle, with Alt/Option-click on the
 * line as a power gesture. Toggling the global `wrap` control clears every
 * per-line override, so the global always wins.
 */
export const Interactive: Story = {
  args: {timestamps: 'rel'},
  render: (args) => {
    const lines: {id: number; ts: number; text: string; tone?: LogRowTone}[] = [
      {id: 1, ts: 0.12, text: 'pnpm vitest run --reporter=verbose --coverage'},
      {
        id: 2,
        ts: 1.04,
        tone: 'error',
        text: 'ERROR  TypeError: Cannot read properties of undefined (reading "id") at withRetry (src/api/retry.ts:42:18) at async runStep (src/runner/step.ts:118:7)',
      },
      {id: 3, ts: 1.22, text: 'compiled 1284 modules in 1.2s'},
      {
        id: 4,
        ts: 2.31,
        tone: 'warning',
        text: 'WARN  deprecated glob@7: upgrade to glob@10 to avoid the slow recursive walk on large repositories',
      },
      {id: 5, ts: 2.95, text: 'done in 412ms'},
    ];
    const [, updateArgs] = useArgs();
    const [exceptions, setExceptions] = useState<ReadonlySet<number>>(() => new Set());

    // Toggling the global `wrap` control clears the per-line overrides so the
    // global wins. Adjusted during render: React's reset-on-prop-change pattern.
    const lastWrap = useRef(args.wrap);
    if (lastWrap.current !== args.wrap) {
      lastWrap.current = args.wrap;
      if (exceptions.size > 0) setExceptions(new Set());
    }

    const toggleLine = (id: number) =>
      setExceptions((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

    return (
      <div className="flex max-w-2xl flex-col gap-8">
        <Code variant="label" className="text-foreground-neutral-muted">
          Globals come from the Controls panel · the chevron (or ⌥-click) wraps one line ·{' '}
          {exceptions.size} overridden
        </Code>
        <LogRows
          {...args}
          timestampOrigin={origin}
          onTimestampsClick={() => updateArgs({timestamps: toggleTimestampUnit(args.timestamps)})}
        >
          {lines.map((line) => {
            const overridden = exceptions.has(line.id);
            const rowWrap = overridden ? !args.wrap : undefined;
            const wrapped = rowWrap ?? args.wrap;
            return (
              <LogRow
                key={line.id}
                lineNumber={line.id}
                timestamp={at(line.ts)}
                tone={line.tone}
                wrap={rowWrap}
              >
                <div className="flex items-start gap-8">
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: Alt-click is a pointer-only shortcut; the chevron is the accessible toggle and plain clicks/selection are deliberately untouched so copy still works. */}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the chevron button, not the text. */}
                  <span
                    className="min-w-0 flex-1"
                    onClick={(event) => {
                      if (event.altKey) toggleLine(line.id);
                    }}
                  >
                    <LogContent variant="code">{line.text}</LogContent>
                  </span>
                  <LogWrapToggle
                    wrapped={wrapped}
                    overridden={overridden}
                    onClick={() => toggleLine(line.id)}
                  />
                </div>
              </LogRow>
            );
          })}
        </LogRows>
      </div>
    );
  },
};

export const Hover: Story = {
  parameters: {pseudo: {hover: ['.story-hovered']}},
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogRow lineNumber={1}>
          <LogContent variant="code">a resting row</LogContent>
        </LogRow>
        <LogRow lineNumber={2} className="story-hovered">
          <LogContent variant="code">hovered: the row tints to mark the pointer target</LogContent>
        </LogRow>
        <LogRow lineNumber={3} className="story-hovered" selected>
          <LogContent variant="code">selected + hovered: the cursor row stays distinct</LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

/**
 * `LogContent` selects body typography. `text` is prose in the display font;
 * `code` is monospace with whitespace preserved. Either accepts arbitrary
 * children, and the code variant can parse ANSI from a string.
 */
export const Content: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogRow lineNumber={1}>
          <LogContent variant="text">
            variant="text": prose in the display font that wraps like normal copy.
          </LogContent>
        </LogRow>
        <LogRow lineNumber={2}>
          <LogContent variant="code">variant="code": monospace output</LogContent>
        </LogRow>
        <LogRow lineNumber={3}>
          <LogContent variant="code">{'  whitespace   and\ttabs   are preserved'}</LogContent>
        </LogRow>
        <LogRow lineNumber={4}>
          <LogContent variant="code" ansi>
            {`${ESC}[32m✓${ESC}[0m code + ansi: escapes become themed spans`}
          </LogContent>
        </LogRow>
        <LogRow lineNumber={5}>
          <LogContent>
            <span className="inline-flex items-center gap-6">
              arbitrary children: <Badge variant="neutral">any node</Badge>
            </span>
          </LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

/**
 * `LogContent variant="code" ansi` parses SGR escapes into themed spans:
 * the 16 colors, their bright variants, bold / dim / italic / underline, and
 * backgrounds. Reset and default codes clear styling; unknown codes are dropped.
 */
export const Ansi: Story = {
  render: () => {
    const lines = [
      `${ESC}[31mred${ESC}[0m ${ESC}[32mgreen${ESC}[0m ${ESC}[33myellow${ESC}[0m ${ESC}[34mblue${ESC}[0m ${ESC}[35mmagenta${ESC}[0m ${ESC}[36mcyan${ESC}[0m`,
      `${ESC}[91mbright red${ESC}[0m ${ESC}[92mbright green${ESC}[0m ${ESC}[96mbright cyan${ESC}[0m`,
      `${ESC}[1mbold${ESC}[0m ${ESC}[2mdim${ESC}[0m ${ESC}[3mitalic${ESC}[0m ${ESC}[4munderline${ESC}[0m`,
      `${ESC}[42;30m black on green ${ESC}[0m then ${ESC}[1;31mbold red${ESC}[39m default again${ESC}[0m`,
      `${ESC}[32m✓${ESC}[0m built ${ESC}[34m1284${ESC}[0m modules · ${ESC}[1;31m1 error${ESC}[0m`,
    ];
    return (
      <div className="max-w-3xl">
        <LogRows>
          {lines.map((line, index) => (
            <LogRow key={line} lineNumber={index + 1}>
              <LogContent variant="code" ansi>
                {line}
              </LogContent>
            </LogRow>
          ))}
        </LogRows>
      </div>
    );
  },
};

/**
 * `LogHeader` is an optional band inside a row body: a left cluster plus an
 * optional right-aligned `end` slot. It is pure layout: supply the glyphs,
 * badges, and meta yourself.
 */
export const Header: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogRow lineNumber={1}>
          <LogHeader>
            <Glyph className="text-purple-500 dark:text-purple-400">{'✦'}</Glyph>
            <Badge variant="feature">Assistant</Badge>
          </LogHeader>
        </LogRow>
        <LogRow lineNumber={2}>
          <LogHeader end={<>claude-sonnet-4-5 · $0.084 · 2.1s</>}>
            <Glyph className="text-purple-500 dark:text-purple-400">{'✦'}</Glyph>
            <Badge variant="feature">Assistant</Badge>
          </LogHeader>
        </LogRow>
        <LogRow lineNumber={3}>
          <LogHeader end={<>64 lines</>}>
            <Glyph className="text-blue-500 dark:text-blue-400">{'⚙'}</Glyph>
            <span className="font-bold text-blue-600 dark:text-blue-400">read_file</span>
          </LogHeader>
        </LogRow>
        <LogRow lineNumber={4}>
          <LogHeader end={<>exit 0</>}>
            <Badge variant="success">bash</Badge>
          </LogHeader>
          <LogContent variant="code">$ pnpm build</LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

/**
 * Composition is the API. The library ships no record components: output
 * lines, agent turns, tool results, and timeline markers are all assembled from
 * the four primitives, interleaved in one stream.
 */
export const Composition: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows timestamps="abs" timestampOrigin={origin} className="max-h-96">
        <LogRow lineNumber={41} timestamp={at(8.12)}>
          <LogContent variant="code">
            <Glyph className="text-green-500 dark:text-green-400">{'$ '}</Glyph>pnpm vitest run
          </LogContent>
        </LogRow>
        <LogRow lineNumber={42} timestamp={at(9.0)} tone="accent">
          <LogHeader end={<>$0.084 · 2.1s</>}>
            <Glyph className="text-purple-500 dark:text-purple-400">{'✦'}</Glyph>
            <Badge variant="feature">Assistant</Badge>
          </LogHeader>
          <LogContent>Re-running the failing shard.</LogContent>
        </LogRow>
        <LogRow lineNumber={43} timestamp={at(9.22)} indent={1}>
          <LogContent variant="code">
            <Glyph className="text-blue-500 dark:text-blue-400">{'⚙ '}</Glyph>
            <span className="font-bold text-blue-600 dark:text-blue-400">read_file</span>
            <span className="text-foreground-neutral-muted"> src/api/client.ts</span>
          </LogContent>
        </LogRow>
        <LogRow lineNumber={44} timestamp={at(9.54)} indent={1}>
          <LogContent variant="code" className="text-foreground-neutral-muted">
            <Glyph className="font-bold text-green-500 dark:text-green-400">{'✓ '}</Glyph>
            read_file · 64 lines
          </LogContent>
        </LogRow>
        <LogRow lineNumber={45} timestamp={at(10.12)} tone="error">
          <LogContent variant="code">
            <span className="font-bold text-red-600 dark:text-red-400">FAIL </span>
            client.test.ts &gt; retries on 503
          </LogContent>
        </LogRow>
        <LogRow tone="warning">
          <LogContent>
            <span className="inline-flex w-full items-center gap-8 text-orange-600 dark:text-orange-300">
              {'⚠'} <b>End of log · 1.5 KB</b>
              <span className="h-px flex-1 border-t border-dashed border-current opacity-40" />
            </span>
          </LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};
