import type {WorkflowContextName} from './workflow-context.js';

/**
 * Reader-facing descriptions for every context root and property.
 *
 * They live beside the type registry so a new field cannot ship undescribed:
 * the documentation generator renders types from the registry and looks up each
 * property here, and its check fails on a property with no description or a
 * description for a property that no longer exists.
 */
export interface WorkflowContextDoc {
  readonly root: WorkflowContextName;
  readonly summary: string;
  /** Why an open-shape root has no property table. */
  readonly shapeNote?: string;
  /** Prefix shown in the property column, such as `needs[*].`. */
  readonly propertyPrefix?: string;
  /** Description per property path, relative to the root. */
  readonly fields?: Readonly<Record<string, string>>;
  /** Paths whose element shape another root already documents. */
  readonly collapse?: readonly string[];
}

const executionFields = {
  index: 'Position of the execution in its job, starting at zero.',
  name: 'Resolved execution name, or the job name when `execution_name` is not set.',
  status: 'Final status of the execution.',
  started_at: 'Time the execution started.',
  finished_at: 'Time the execution finished.',
  events: 'Listener events in the batch that started this execution. Empty for a standard job.',
  'events[*].source': 'Integration connection slug that delivered the event.',
  'events[*].event': 'Shipfox event name.',
  'events[*].delivery_id': 'Identifier of the provider delivery.',
  'events[*].received_at': 'Time Shipfox received the event.',
  'events[*].project':
    'Shipfox project resolved from the event repository. Null when there is none.',
  'events[*].project.id': 'Identifier of the resolved project.',
  'events[*].repository':
    'Repository the event came from, as `owner/name`. Null when there is none.',
  'events[*].ref': 'Git ref the event carried. Null when there is none.',
  'events[*].commit': 'Commit SHA the event carried. Null when there is none.',
  'events[*].data': 'Raw event payload. The provider owns its shape.',
  outputs: 'Outputs the execution produced, keyed by output name.',
} as const;

const jobEntityFields = {
  key: 'Key of the job in the `jobs` map.',
  status: 'Final status of the job.',
  outputs: 'Declared job outputs, keyed by output name.',
  executions:
    'Executions of the job, each with the properties of the `execution` context. A standard job has one.',
} as const;

const stepEntityFields = {
  status: 'Final status of the step.',
  exit_code: 'Exit code of the most recent finished attempt.',
  outputs: 'Declared step outputs of the most recent finished attempt.',
  response: 'Final agent response. Absent on a run step.',
  gate: 'Gate result of the most recent finished attempt. Absent when the step has no gate.',
  'gate.passed': 'Whether the gate expression passed.',
  'gate.source': 'Gate expression that produced the result.',
  'gate.reason': 'Why Shipfox could not check the gate.',
  'gate.exit_code': 'Exit code the gate read.',
  attempts: 'Every finished attempt of the step, oldest first.',
  'attempts[*].status': 'Final status of the attempt.',
  'attempts[*].exit_code': 'Exit code the attempt reported.',
  'attempts[*].outputs': 'Declared outputs the attempt reported.',
  'attempts[*].response': 'Final agent response of the attempt. Absent on a run step.',
  'attempts[*].gate': 'Gate result of the attempt. Absent when the step has no gate.',
  'attempts[*].gate.passed': 'Whether the gate expression passed.',
  'attempts[*].gate.source': 'Gate expression that produced the result.',
  'attempts[*].gate.reason': 'Why Shipfox could not check the gate.',
  'attempts[*].gate.exit_code': 'Exit code the gate read.',
} as const;

export const workflowContextDocs = [
  {
    root: 'workflow',
    summary: 'The workflow definition this run came from.',
    fields: {
      id: 'Identifier of the workflow definition.',
      name: 'Workflow `name` from the definition.',
    },
  },
  {
    root: 'run',
    summary: 'The current run.',
    fields: {
      id: 'Identifier of the run.',
      number: 'Sequential run number within the workflow definition.',
      name: 'Resolved run name, or the workflow name when `run_name` is not set.',
      project_id: 'Identifier of the project that owns the run.',
      workspace_id: 'Identifier of the workspace that owns the run.',
      created_at: 'Time the run was created.',
    },
  },
  {
    root: 'trigger',
    summary: 'The trigger that started the run.',
    fields: {
      source: 'Integration connection slug, or `manual` or `cron`.',
      event: 'Shipfox event name that matched the trigger.',
      project: 'Shipfox project resolved from the event repository. Null when there is none.',
      'project.id': 'Identifier of the resolved project.',
      repository: 'Repository the event came from, as `owner/name`. Null when there is none.',
      ref: 'Git ref the event carried. Null when there is none.',
      commit: 'Commit SHA the event carried. Null when there is none.',
    },
  },
  {
    root: 'event',
    summary: 'The raw payload of the event that started the run.',
    shapeNote:
      'The provider owns this payload, so it has no fixed shape. Each provider page under [Integrations](/integrations) lists the events Shipfox delivers and links the payload each one carries.',
  },
  {
    root: 'inputs',
    summary: 'Values the trigger `with` block passed into the run.',
    shapeNote:
      'The keys are the ones the trigger declares. See [trigger fields](/reference/workflow-schema#trigger-fields).',
  },
  {
    root: 'job',
    summary: 'The current job.',
    fields: {
      key: 'Key of the job in the `jobs` map.',
      name: 'Job `name`, or the job key when no name is set.',
    },
  },
  {
    root: 'executions',
    summary: 'Every execution of the current job.',
    propertyPrefix: 'executions[*].',
    fields: executionFields,
  },
  {
    root: 'execution',
    summary: 'The current execution of the job.',
    fields: {
      ...executionFields,
      failed: 'Whether an earlier step in this execution failed.',
    },
  },
  {
    root: 'jobs',
    summary: 'Upstream jobs, keyed by job key.',
    shapeNote: 'The keys are the job keys the workflow declares.',
    propertyPrefix: 'jobs.<job_key>.',
    fields: jobEntityFields,
    collapse: ['executions'],
  },
  {
    root: 'needs',
    summary: 'The jobs this job declares in `needs`.',
    propertyPrefix: 'needs[*].',
    fields: jobEntityFields,
    collapse: ['executions'],
  },
  {
    root: 'steps',
    summary: 'Earlier steps of the current job, keyed by step key.',
    shapeNote: 'The keys are the step keys the workflow declares.',
    propertyPrefix: 'steps.<step_key>.',
    fields: stepEntityFields,
  },
  {
    root: 'step',
    summary: 'The current step. Its properties depend on the field that reads it.',
    fields: {
      attempt: 'Attempt number of the step, starting at one. Not readable in `gate.success`.',
      is_retry: 'Whether this is a repeat attempt. Not readable in `gate.success`.',
      restart: 'Set when a gate restarted this step. Not readable in `gate.success`.',
      'restart.from':
        'The step whose gate restarted this attempt, with the properties of a `steps` entry. Not readable in `gate.success`.',
      'restart.feedback': 'Feedback the restarting gate produced. Not readable in `gate.success`.',
      exit_code: 'Exit code the step reported. Readable in `gate.success` only.',
      status: 'Status the step reported. Readable in `gate.success` only.',
      outputs: 'Outputs the step reported. Readable in `gate.success` only.',
    },
    collapse: ['restart.from'],
  },
  {
    root: 'vars',
    summary: 'Workspace and project variables.',
    shapeNote:
      'The keys are the variable names the workspace defines. See [Secrets and variables](/reference/secrets-variables).',
  },
  {
    root: 'secrets',
    summary: 'Workspace and project secrets.',
    shapeNote:
      'The keys are the secret names the workspace defines. See [Secrets and variables](/reference/secrets-variables).',
  },
] as const satisfies readonly WorkflowContextDoc[];
