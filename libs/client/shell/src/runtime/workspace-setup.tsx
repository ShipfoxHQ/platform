import {ApiError} from '@shipfox/client-api';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Header, Text} from '@shipfox/react-ui/typography';
import type {QueryClient} from '@tanstack/react-query';
import {type ErrorComponentProps, useRouter} from '@tanstack/react-router';
import {FocusedFrame} from '#components/focused-frame.js';

export interface WorkspaceSetupState {
  hideProjectNavigation: boolean;
  unavailable?: boolean;
}
export interface WorkspaceSetupRouteOptions {
  queryClient: QueryClient;
  workspaceId: string;
  workspaceSlug: string;
  pathname: string;
}
export type WorkspaceSetupGate = (
  options: WorkspaceSetupRouteOptions,
) => Promise<WorkspaceSetupState>;

export class WorkspaceSetupLoadError extends Error {
  constructor(public override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Workspace setup load failed');
    this.name = 'WorkspaceSetupLoadError';
  }
}
export function WorkspaceSetupPending() {
  return <FullPageLoader />;
}

export function WorkspaceUnavailablePage({workspaceName}: {workspaceName?: string | undefined}) {
  return (
    <main className="min-h-screen bg-background-subtle-base px-frame py-frame max-[520px]:px-row">
      <FocusedFrame className="flex flex-col gap-cluster">
        <Header variant="h1">Workspace unavailable</Header>
        <Text size="md" className="text-foreground-neutral-muted">
          {workspaceName
            ? `${workspaceName} is currently unavailable.`
            : 'This workspace is currently unavailable.'}{' '}
          Please contact your configured support contact if you need help.
        </Text>
      </FocusedFrame>
    </main>
  );
}
export function WorkspaceLayoutErrorRoute({error, reset}: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };
  const setupError = error instanceof WorkspaceSetupLoadError;
  const message =
    error instanceof ApiError
      ? error.message
      : setupError && error.cause instanceof ApiError
        ? error.cause.message
        : 'Try again in a moment.';
  return (
    <main className="min-h-screen bg-background-subtle-base px-frame py-frame max-[520px]:px-row">
      <FocusedFrame className="flex flex-col gap-section">
        <Header variant="h1">{setupError ? 'Workspace setup' : 'Workspace'}</Header>
        <Callout role="alert" type="error">
          <div className="flex flex-col gap-inline">
            <Text size="sm" bold>
              {setupError ? 'Could not load workspace setup' : 'Could not load workspace'}
            </Text>
            <Text size="sm">{message}</Text>
            <Button size="sm" variant="secondary" onClick={retry} className="w-fit">
              Retry
            </Button>
          </div>
        </Callout>
      </FocusedFrame>
    </main>
  );
}
