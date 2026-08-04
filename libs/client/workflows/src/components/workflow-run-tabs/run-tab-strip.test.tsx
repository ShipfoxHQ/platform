import {Tabs} from '@shipfox/react-ui/tabs';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import {RunTabStrip} from './run-tab-strip.js';

const ANNOTATION_SUMMARY: RunAnnotationSummary = {
  total: 5,
  error: 2,
  warning: 1,
  info: 2,
  success: 0,
};

describe('RunTabStrip', () => {
  test('exposes tab counts and keyboard navigation', async () => {
    const user = userEvent.setup();

    await renderStrip({annotationSummary: ANNOTATION_SUMMARY, jobCount: 3, jobsFailed: 1});

    const jobsTab = screen.getByRole('tab', {name: 'Jobs, 3 jobs, 1 failed'});
    const annotationsTab = screen.getByRole('tab', {
      name: 'Annotations, 5 annotations, 2 errors',
    });
    expect(within(jobsTab).getByText('3')).toHaveClass('bg-tag-neutral-bg');
    expect(within(jobsTab).getByText('1 failed')).toHaveClass('bg-tag-error-bg');
    expect(within(annotationsTab).getByText('5')).toHaveClass('bg-tag-neutral-bg');
    expect(within(annotationsTab).getByText('2 errors')).toHaveClass('bg-tag-error-bg');
    expect(screen.queryByRole('link', {name: '2 errors'})).not.toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Source'})).toHaveClass(
      'data-[state=inactive]:text-foreground-neutral-subtle',
      'data-[state=inactive]:hover:text-foreground-neutral-base',
    );

    const summary = screen.getByRole('tab', {name: 'Summary'});
    expect(screen.getByRole('tablist', {name: 'Run sections'})).toHaveClass('min-w-full', 'px-16');
    expect(summary.parentElement?.parentElement).toHaveClass('bg-background-neutral-background');
    summary.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', {name: 'Jobs, 3 jobs, 1 failed'})).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', {name: 'Summary'})).toHaveAttribute('tabindex', '-1');
  });

  test('does not reserve count space when data is absent', async () => {
    await renderStrip({annotationSummary: undefined, jobCount: undefined});

    const jobsTab = screen.getByRole('tab', {name: 'Jobs'});
    const annotationsTab = screen.getByRole('tab', {name: 'Annotations'});

    expect(jobsTab).toBeInTheDocument();
    expect(annotationsTab).toBeInTheDocument();
    expect(jobsTab.querySelector('[data-slot="badge"]')).toBeNull();
    expect(annotationsTab.querySelector('[data-slot="badge"]')).toBeNull();
    expect(screen.queryByText('5 annotations')).not.toBeInTheDocument();
  });

  test('singularizes accessible count labels', async () => {
    await renderStrip({
      annotationSummary: {total: 1, error: 1, warning: 0, info: 0, success: 0},
      jobCount: 1,
      jobsFailed: 1,
    });

    expect(screen.getByRole('tab', {name: 'Jobs, 1 job, 1 failed'})).toBeInTheDocument();
    expect(
      screen.getByRole('tab', {name: 'Annotations, 1 annotation, 1 error'}),
    ).toBeInTheDocument();
  });
});

async function renderStrip({
  annotationSummary,
  jobCount,
  jobsFailed = 0,
}: {
  annotationSummary?: RunAnnotationSummary | undefined;
  jobCount?: number | undefined;
  jobsFailed?: number | undefined;
} = {}) {
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <Tabs defaultValue="summary">
        <RunTabStrip
          jobCount={jobCount}
          jobsFailed={jobsFailed}
          annotationSummary={annotationSummary}
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
