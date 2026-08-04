import {Tabs} from '@shipfox/react-ui/tabs';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import type {WorkflowRunsSearch} from '#routes/inputs.js';
import {RunTabStrip} from './run-tab-strip.js';

const ANNOTATION_SUMMARY: RunAnnotationSummary = {
  total: 5,
  error: 2,
  warning: 1,
  info: 2,
  success: 0,
};

describe('RunTabStrip', () => {
  test('exposes tab counts, severity links, and keyboard navigation', async () => {
    const user = userEvent.setup();

    await renderStrip({annotationSummary: ANNOTATION_SUMMARY, jobCount: 3});

    expect(screen.getByRole('tab', {name: 'Jobs, 3 jobs'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Annotations, 5 annotations'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '2 errors'})).toHaveAttribute(
      'href',
      '/w/acme/p/project/runs/run-1?tab=annotations&severity=error',
    );

    const summary = screen.getByRole('tab', {name: 'Summary'});
    summary.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', {name: 'Jobs, 3 jobs'})).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', {name: 'Summary'})).toHaveAttribute('tabindex', '-1');
  });

  test('keeps count slots stable when data is absent', async () => {
    await renderStrip({annotationSummary: undefined, jobCount: undefined});

    const jobsTab = screen.getByRole('tab', {name: 'Jobs'});
    const annotationsTab = screen.getByRole('tab', {name: 'Annotations'});

    expect(jobsTab).toBeInTheDocument();
    expect(annotationsTab).toBeInTheDocument();
    expect(jobsTab.querySelector('.min-w-24')).not.toBeNull();
    expect(annotationsTab.querySelector('.min-w-24')).not.toBeNull();
    expect(screen.queryByText('5 annotations')).not.toBeInTheDocument();
  });

  test('singularizes accessible count labels', async () => {
    await renderStrip({
      annotationSummary: {total: 1, error: 1, warning: 0, info: 0, success: 0},
      jobCount: 1,
    });

    expect(screen.getByRole('tab', {name: 'Jobs, 1 job'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Annotations, 1 annotation'})).toBeInTheDocument();
  });

  test('clears a stale annotation when linking to a severity', async () => {
    await renderStrip({
      annotationSummary: ANNOTATION_SUMMARY,
      jobCount: 3,
      search: {annotation: 'annotation-old'},
    });

    expect(screen.getByRole('link', {name: '2 errors'})).toHaveAttribute(
      'href',
      '/w/acme/p/project/runs/run-1?tab=annotations&severity=error',
    );
  });
});

async function renderStrip({
  annotationSummary,
  jobCount,
  search,
}: {
  annotationSummary?: RunAnnotationSummary | undefined;
  jobCount?: number | undefined;
  search?: WorkflowRunsSearch | undefined;
} = {}) {
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <Tabs defaultValue="summary">
        <RunTabStrip
          jobCount={jobCount}
          jobsFailed={1}
          annotationSummary={annotationSummary}
          workspaceSlug="acme"
          projectSlug="project"
          workflowRunId="run-1"
          search={search}
        />
      </Tabs>
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
  if (!result) throw new Error('Run tab strip did not render.');
  return result;
}
