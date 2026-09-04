import type {TriggerEventDetailResponseDto} from '@shipfox/api-triggers-dto';
import {projectsQueryKeys} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {toTriggerEventDetail} from '#hooks/api/trigger-event-mapper.js';
import {useTriggerEventQuery} from '#hooks/api/trigger-events.js';
import {TriggerEventDetail, TriggerEventDetailView} from './trigger-event-detail.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const DEPLOY_RUN_LINK_NAME = /deploy-web #184/u;
const PAYLOAD_REF_LINE = /"ref": "refs\/heads\/main"/u;

const useTriggerEventQueryMock = vi.mocked(useTriggerEventQuery);

function makeEvent(
  overrides: Partial<TriggerEventDetailResponseDto> = {},
): TriggerEventDetailResponseDto {
  return {
    id: EVENT_ID,
    event_ref: 'github:delivery-179:push',
    origin: 'integration',
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    source: 'github',
    event: 'push',
    replay_of_event_id: null,
    delivery_id: 'delivery-179',
    connection_id: '55555555-5555-4555-8555-555555555555',
    connection_name: 'ShipfoxHQ Production',
    outcome: 'routed',
    matched_count: 1,
    payload: {ref: 'refs/heads/main', action: 'push'},
    received_at: '2026-06-25T19:30:00.000Z',
    processed_at: '2026-06-25T19:30:02.000Z',
    created_at: '2026-06-25T19:30:00.000Z',
    decisions: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        received_event_id: EVENT_ID,
        subscription_kind: 'trigger',
        subscription_id: '77777777-7777-4777-8777-777777777777',
        subscription_name: 'Deploy production',
        workflow_definition_id: '88888888-8888-4888-8888-888888888888',
        project_id: PROJECT_ID,
        workflow_run_id: null,
        job_id: null,
        matcher_kind: null,
        matcher_ordinal: null,
        decision: 'triggered',
        run_id: RUN_ID,
        run_name: 'deploy-web #184',
        reason: null,
        created_at: '2026-06-25T19:30:02.000Z',
      },
    ],
    replays: [],
    ...overrides,
  };
}

function renderWithProviders(
  ui: ReactElement,
  {includeListProject = true, includeDetailProject = false} = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false, staleTime: Infinity}},
  });
  const project = {id: PROJECT_ID, slug: 'checkout-api'};
  queryClient.setQueryData(projectsQueryKeys.list(WORKSPACE_ID), {
    pages: [{projects: includeListProject ? [project] : [], nextCursor: null}],
    pageParams: [undefined],
  });
  if (includeDetailProject) queryClient.setQueryData(projectsQueryKeys.detail(PROJECT_ID), project);
  return render(
    <QueryClientProvider client={queryClient}>
      <RelativeTimeProvider>{ui}</RelativeTimeProvider>
    </QueryClientProvider>,
  );
}

function renderDetailView(
  event: TriggerEventDetailResponseDto,
  onBack = vi.fn(),
  options?: {includeListProject?: boolean; includeDetailProject?: boolean},
) {
  return renderWithProviders(
    <TriggerEventDetailView
      workspaceId={WORKSPACE_ID}
      workspaceSlug="acme"
      event={toTriggerEventDetail(event)}
      onBack={onBack}
    />,
    options,
  );
}

describe('TriggerEventDetailView', () => {
  test('renders the result badge, run links, and payload', async () => {
    renderDetailView(makeEvent());

    expect(await screen.findByText('Triggered 1 workflow')).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Workflow decisions'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Payload'})).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(2);
    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: DEPLOY_RUN_LINK_NAME})).toHaveAttribute(
      'href',
      `/w/acme/p/checkout-api/runs/${RUN_ID}`,
    );
    expect(screen.getByText(PAYLOAD_REF_LINE)).toBeInTheDocument();
  });

  test('renders a no-match note for a discarded event', async () => {
    renderDetailView(makeEvent({outcome: 'discarded', matched_count: 0, decisions: []}));

    expect(await screen.findByText('No workflows triggered')).toBeInTheDocument();
    expect(screen.getByText('No workflow matched this event.')).toBeInTheDocument();
    expect(screen.queryByText('Workflow decisions')).not.toBeInTheDocument();
  });

  test('does not expose an unclassified legacy reason', async () => {
    renderDetailView(
      makeEvent({
        outcome: 'errored',
        decisions: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            received_event_id: EVENT_ID,
            subscription_kind: 'trigger',
            subscription_id: '77777777-7777-4777-8777-777777777777',
            subscription_name: 'Deploy production',
            workflow_definition_id: '88888888-8888-4888-8888-888888888888',
            project_id: PROJECT_ID,
            workflow_run_id: null,
            job_id: null,
            matcher_kind: null,
            matcher_ordinal: null,
            decision: 'dispatch-error',
            run_id: null,
            run_name: null,
            reason: 'workflow definition deleted',
            created_at: '2026-06-25T19:30:02.000Z',
          },
        ],
      }),
    );

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByText('Workflow processing failed')).toBeInTheDocument();
    expect(screen.queryByText('workflow definition deleted')).not.toBeInTheDocument();
  });

  test('renders the exact unavailable expression path in the failure callout', async () => {
    renderDetailView(
      makeEvent({
        decisions: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            received_event_id: EVENT_ID,
            subscription_kind: 'trigger',
            subscription_id: '77777777-7777-4777-8777-777777777777',
            subscription_name: 'Deploy production',
            workflow_definition_id: '88888888-8888-4888-8888-888888888888',
            project_id: PROJECT_ID,
            workflow_run_id: null,
            job_id: null,
            matcher_kind: null,
            matcher_ordinal: null,
            decision: 'filter-error',
            run_id: null,
            run_name: null,
            reason: null,
            diagnostic: {
              version: 1,
              code: 'expression-missing-path',
              path: 'trigger.repository',
            },
            created_at: '2026-06-25T19:30:02.000Z',
          },
        ],
      }),
    );

    expect(await screen.findByText('Trigger filter could not be evaluated')).toBeInTheDocument();
    expect(screen.getByText('trigger.repository')).toBeInTheDocument();
    expect(screen.getByText('Filter could not be evaluated')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="callout"]')).toHaveTextContent(
      'trigger.repository is not available in the Deploy production filter. No workflow run was created.',
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('resolves a matched project from its detail query when it is not in the list page', async () => {
    renderDetailView(makeEvent(), vi.fn(), {
      includeListProject: false,
      includeDetailProject: true,
    });

    expect(await screen.findByRole('link', {name: DEPLOY_RUN_LINK_NAME})).toHaveAttribute(
      'href',
      `/w/acme/p/checkout-api/runs/${RUN_ID}`,
    );
  });

  test('calls onBack from the focused detail panel control', async () => {
    const onBack = vi.fn();
    renderDetailView(makeEvent(), onBack);

    await userEvent.click(await screen.findByRole('button', {name: 'Back to events'}));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('TriggerEventDetail', () => {
  beforeEach(() => {
    useTriggerEventQueryMock.mockReset();
  });

  test('renders a loading panel while the detail query is pending', async () => {
    useTriggerEventQueryMock.mockReturnValue({
      data: undefined,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTriggerEventQuery>);

    renderWithProviders(<TriggerEventDetail eventId={EVENT_ID} onBack={vi.fn()} />);

    expect(await screen.findByRole('button', {name: 'Back to events'})).toBeInTheDocument();
  });

  test('renders a retry action when the detail query fails', async () => {
    const refetch = vi.fn();
    useTriggerEventQueryMock.mockReturnValue({
      data: undefined,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useTriggerEventQuery>);

    renderWithProviders(<TriggerEventDetail eventId={EVENT_ID} onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', {name: 'Retry'}));

    expect(screen.getByText('Event detail could not be loaded.')).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
