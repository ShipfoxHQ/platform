import {Component, type PropsWithChildren} from 'react';

export interface ReportErrorBoundaryProps extends PropsWithChildren {
  /** Message reported when the guarded slot throws; names the slot in diagnostics. */
  label: string;
  /** Called after a render failure so an owner can collapse the reserved slot. */
  onError?: () => void;
  /** Called when the boundary clears the error to retry the slot. */
  onRecovered?: () => void;
  /**
   * Stable value the owner changes only when the guarded slot should be
   * retried. The boundary latches on failure and resets only when this value
   * changes, so owner rerenders triggered by `onError`/`onRecovered` never
   * retry the same failing slot in a loop.
   */
  retryKey?: unknown;
}

type ReportErrorBoundaryState = {hasError: boolean};

function reportFailure(label: string, cause: unknown): void {
  const failure = new Error(label, {cause});
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(failure);
  } else {
    // biome-ignore lint/suspicious/noConsole: Failure reporting keeps a console fallback where reportError is unavailable.
    console.error(label, cause);
  }
}

/**
 * Isolates an optional chrome slot from the rest of the shell. A render
 * failure reports the error and renders nothing instead of unmounting the
 * shell; the owner retries the slot by passing a new `retryKey`, so a
 * transient failure recovers without a reload.
 */
export class ReportErrorBoundary extends Component<
  ReportErrorBoundaryProps,
  ReportErrorBoundaryState
> {
  override state: ReportErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): ReportErrorBoundaryState {
    return {hasError: true};
  }

  override componentDidCatch(error: unknown): void {
    reportFailure(this.props.label, error);
    this.props.onError?.();
  }

  override componentDidUpdate(prevProps: ReportErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.retryKey !== this.props.retryKey) {
      this.setState({hasError: false});
      this.props.onRecovered?.();
    }
  }

  override render() {
    return this.state.hasError ? null : this.props.children;
  }
}
