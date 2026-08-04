import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen} from '@testing-library/react';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import type {WorkflowRunsSearch} from '#routes/inputs.js';
import {RunAnnotationSummaryLine} from './run-annotation-summary-line.js';

const ANNOTATION_SUMMARY: RunAnnotationSummary = {
  total: 5,
  error: 2,
  warning: 1,
  info: 2,
  success: 0,
};

describe('RunAnnotationSummaryLine', () => {
  test('links the severity breakdown into the Annotations panel', async () => {
    await renderSummaryLine();

    expect(screen.getByText('5 annotations')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '2 errors'})).toHaveAttribute(
      'href',
      '/w/acme/p/project/runs/run-1?tab=annotations&severity=error',
    );
  });

  test('clears a stale annotation when linking to a severity', async () => {
    await renderSummaryLine({annotation: 'annotation-old'});

    expect(screen.getByRole('link', {name: '2 errors'})).toHaveAttribute(
      'href',
      '/w/acme/p/project/runs/run-1?tab=annotations&severity=error',
    );
  });
});

async function renderSummaryLine(search: WorkflowRunsSearch = {}) {
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <RunAnnotationSummaryLine
        summary={ANNOTATION_SUMMARY}
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
