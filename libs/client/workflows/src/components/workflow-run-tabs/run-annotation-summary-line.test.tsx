import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen} from '@testing-library/react';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import type {WorkflowRunsSearch} from '#routes/inputs.js';
import {RunAnnotationSummaryLine} from './run-annotation-summary-line.js';

const ANNOTATION_SUMMARY: RunAnnotationSummary = {
  total: 5,
  error: 2,
  warning: 1,
  info: 2,
  success: 0,
  truncated: false,
};

const INFO_OR_SUCCESS_PATTERN = /info|success/;
const SHOW_ALL_PATTERN = /Show all/;

describe('RunAnnotationSummaryLine', () => {
  test('links the severity breakdown into the Annotations panel', async () => {
    await renderSummaryLine();

    expect(screen.getByText('5 annotations')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '2 errors'})).toHaveAttribute(
      'href',
      '/w/acme/p/project/runs/run-1?tab=annotations&severity=error',
    );
  });

  test('renders every count at one type scale', async () => {
    // The severity counts previously bypassed `Text` and inherited the ambient 14px, so they
    // rendered a step larger and heavier than the total they sit beside.
    await renderSummaryLine();

    const total = screen.getByText('5 annotations');
    const errors = screen.getByText('2 errors');

    expect(total).toHaveClass('text-xs', 'font-display');
    expect(errors).toHaveClass('text-xs', 'font-display');
    expect(errors).not.toHaveClass('text-foreground-highlight-interactive');
  });

  test('distinguishes severities by glyph rather than by label colour', async () => {
    const {container} = await renderSummaryLine();

    const tones = [...container.querySelectorAll('svg')].map((glyph) =>
      glyph.getAttribute('class'),
    );

    expect(tones.some((tone) => tone?.includes('text-tag-error-icon'))).toBe(true);
    expect(tones.some((tone) => tone?.includes('text-tag-warning-icon'))).toBe(true);
  });

  test('names only the severities that need attention', async () => {
    await renderSummaryLine();

    expect(screen.getByRole('link', {name: '2 errors'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '1 warning'})).toBeInTheDocument();
    // The 2 info annotations are inside the total; naming them again would give a clean
    // result the same weight and the same accent as a failure.
    expect(screen.queryByRole('link', {name: '2 infos'})).not.toBeInTheDocument();
    expect(screen.queryByText(INFO_OR_SUCCESS_PATTERN)).not.toBeInTheDocument();
  });

  test('turns the total into the way out of an active severity filter', async () => {
    await renderSummaryLine({severity: 'error'});

    expect(screen.getByRole('link', {name: 'Show all 5 annotations'})).toHaveAttribute(
      'href',
      '/w/acme/p/project/runs/run-1?tab=annotations',
    );
  });

  test('leaves the total as plain text when no severity filter is active', async () => {
    await renderSummaryLine();

    expect(screen.queryByRole('link', {name: SHOW_ALL_PATTERN})).not.toBeInTheDocument();
  });

  test('falls back to the bare total when nothing needs attention', async () => {
    await renderSummaryLine(
      {},
      {total: 3, error: 0, warning: 0, info: 3, success: 0, truncated: false},
    );

    expect(screen.getByText('3 annotations')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('marks a truncated read as a lower bound', async () => {
    await renderSummaryLine({}, {...ANNOTATION_SUMMARY, truncated: true});

    expect(screen.getByText('5+ annotations')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '2+ errors'})).toBeInTheDocument();
  });
});

async function renderSummaryLine(
  search: WorkflowRunsSearch = {},
  summary: RunAnnotationSummary = ANNOTATION_SUMMARY,
) {
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <RunAnnotationSummaryLine
        summary={summary}
        workspaceSlug="acme"
        projectSlug="project"
        workflowRunId="run-1"
        search={search}
      />
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/w/acme/p/project/runs/run-1']}),
    routeTree: rootRoute.addChildren([runRoute]),
  });
  await router.load();
  let result: ReturnType<typeof render> | undefined;
  await act(() => {
    result = render(<RouterProvider router={router} />);
  });
  if (!result) throw new Error('Run annotation summary did not render.');
  return result;
}
