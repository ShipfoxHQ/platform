import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {screen, waitFor} from 'storybook/test';
import {WorkflowSourcePanel} from './workflow-source-panel.js';

const meta = {
  title: 'Workflows/SourcePanel',
  component: WorkflowSourcePanel,
  parameters: {
    layout: 'fullscreen',
    argos: {
      modes: {
        light: {theme: 'light'},
        dark: {theme: 'dark'},
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen justify-end bg-background-neutral-base">
        <Story />
      </div>
    ),
  ],
  args: {
    id: 'workflow-source-panel',
    open: true,
    source: {
      format: 'yaml',
      content: `name: deploy-web
on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test --filter=@shipfox/client-workflows`,
    },
    highlightedLineRange: {startLine: 10, endLine: 11},
    onClose: () => undefined,
  },
} satisfies Meta<typeof WorkflowSourcePanel>;

export default meta;
type Story = StoryObj<typeof meta>;
type WorkflowSourcePanelStoryContext = Parameters<NonNullable<Story['play']>>[0];

async function captureHighlightedSourcePanel(
  ctx: WorkflowSourcePanelStoryContext,
  screenshotName: string,
) {
  await screen.findByRole('dialog', {name: 'Workflow source'});
  const codeContent = await waitFor(
    () => {
      const content = document.querySelector('.shiki-override')?.textContent?.trim();
      if (!content) {
        throw new Error('Shiki highlighting has not rendered yet');
      }
      return content;
    },
    {timeout: 10_000},
  );
  const loadedCodeFonts = await document.fonts.load('400 14px "Commit Mono"', codeContent);
  if (!loadedCodeFonts.some((font) => font.status === 'loaded')) {
    throw new Error('Commit Mono has not loaded yet');
  }
  await document.fonts.ready;
  await argosScreenshot(ctx, screenshotName);
}

export const Playground: Story = {
  play: async (ctx) => {
    await captureHighlightedSourcePanel(ctx, 'Workflow Source Panel Open');
  },
};

export const LongSource: Story = {
  play: async (ctx) => {
    await captureHighlightedSourcePanel(ctx, 'Workflow Source Panel Long Source');
  },
  args: {
    source: {
      format: 'yaml',
      content: Array.from(
        {length: 24},
        (_, index) => `      - run: pnpm test --filter=@shipfox/package-${index + 1}`,
      ).join('\n'),
    },
  },
};

export const HighlightedDeepInFile: Story = {
  play: async (ctx) => {
    await captureHighlightedSourcePanel(ctx, 'Workflow Source Panel Highlighted Deep In File');
  },
  args: {
    source: {
      format: 'yaml',
      content: Array.from(
        {length: 44},
        (_, index) => `      - run: pnpm test --filter=@shipfox/package-${index + 1}`,
      ).join('\n'),
    },
    highlightedLineRange: {startLine: 34, endLine: 36},
    scrollHighlightedIntoView: true,
  },
};

export const MissingSource: Story = {
  args: {
    open: false,
    source: null,
  },
};
