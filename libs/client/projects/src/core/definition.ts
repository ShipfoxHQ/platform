export interface Definition {
  id: string;
  projectId: string;
  configPath: string | null;
  source: 'manual' | 'vcs';
  sha: string | null;
  ref: string | null;
  name: string;
  workflowDocument: unknown;
  workflowModel: unknown;
  manualTrigger: {name: string} | null;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DefinitionSyncSummary {
  ref: string | null;
  status: 'pending' | 'syncing' | 'succeeded' | 'failed';
  lastSyncAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  diagnostics: DefinitionSyncDiagnostic[];
}

export interface DefinitionSyncDiagnostic {
  code: string;
  message: string;
  path?: string | undefined;
  severity: 'error' | 'warning';
}

export interface DefinitionList {
  definitions: Definition[];
  sync: DefinitionSyncSummary | null;
  nextCursor: string | null;
}
