export interface OverlayBuiltOutputsOptions {
  /** Root directory produced by `turbo prune`. */
  prunedRoot: string;
  /** Workspace containing the turbo-built package dist/ directories. */
  workspaceRoot?: string;
}

/** Copy built dist/ output into a pruned workspace and productionize imports. */
export function overlayBuiltOutputs(options: OverlayBuiltOutputsOptions): void;
