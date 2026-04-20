export interface Trigger {
  type: string;
  on?: string | string[];
  with?: Record<string, unknown>;
  filter?: string;
}

export interface RunStep {
  run: string;
  name?: string;
}

export interface Job {
  needs?: string | string[];
  runner?: string | string[];
  steps: RunStep[];
}

export interface WorkflowSpec {
  name: string;
  triggers?: Record<string, Trigger>;
  runner?: string | string[];
  jobs: Record<string, Job>;
}

export interface WorkflowDefinition {
  id: string;
  projectId: string;
  configPath: string | null;
  source: 'manual' | 'vcs';
  sha: string | null;
  ref: string | null;
  name: string;
  definition: WorkflowSpec;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
