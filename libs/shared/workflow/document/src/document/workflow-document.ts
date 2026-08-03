import {z} from 'zod';
import {checkoutTargetValidationIssues} from './checkout-target-validation.js';
import {agentThinkingSchema, harnessSchema} from './step-enums.js';

const stringOrStringArraySchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const nonEmptyRecordSchema = <ValueSchema extends z.ZodType>(valueSchema: ValueSchema) =>
  z
    .record(z.string().min(1), valueSchema)
    .refine((value) => Object.keys(value).length > 0, {message: 'Expected at least one entry'});

export const WORKFLOW_LITERAL_NAME_PATTERN = /^(?:[^$]|\$\$\{\{|\$(?!\{\{))*$/;
// The inverse of a literal name: a literal prefix followed by an unescaped
// `${{`. An enum field that also accepts a template matches one or the other.
export const WORKFLOW_INTERPOLATED_VALUE_PATTERN = /^(?:[^$]|\$\$\{\{|\$(?!\{\{))*\$\{\{/;

// Reasoning effort is an enum so editors can complete it, and a template so a
// workflow can choose the effort from run context. The resolved value is
// checked against the harness levels when the step is dispatched.
export const agentThinkingFieldSchema = z
  .union([
    agentThinkingSchema,
    z.string().regex(WORKFLOW_INTERPOLATED_VALUE_PATTERN, {
      message:
        'Agent thinking must be a supported level or a $' +
        '{{ }} interpolation that resolves to one.',
    }),
  ])
  .meta({
    description:
      'Reasoning effort for an agent step. Supported values depend on the resolved harness. Accepts a $' +
      '{{ }} interpolation. When omitted, Shipfox uses the provider default, or `xhigh` when none is configured.',
  });

const workflowNameSchema = literalNameSchema(
  'Workflow name must be literal. Move runtime interpolation to run_name.',
).meta({description: 'Static literal human-readable workflow name.'});
const jobNameSchema = literalNameSchema(
  'Job name must be literal. Move runtime interpolation to execution_name.',
).meta({description: 'Static literal human-readable job name.'});

function literalNameSchema(message: string) {
  return z.string().min(1).regex(WORKFLOW_LITERAL_NAME_PATTERN, {message});
}

// Runner shell steps execute on Unix shells, so workflow env names follow the
// portable POSIX-style variable shape.
const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const envStringValueSchema = z.string().refine((value) => !value.includes('\u0000'), {
  message: 'Env string values cannot contain null bytes',
});
export const WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES = 128;
export const WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES = 32 * 1024;
export const workflowDocumentStepOutputTypes = ['string', 'number', 'boolean', 'json'] as const;
export const WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES = WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES;
export const WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES =
  WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES;
export const WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH = 64;

const utf8Encoder = new TextEncoder();

export const workflowDocumentEnvSchema = z
  .record(envNameSchema, z.union([envStringValueSchema, z.number(), z.boolean()]))
  .superRefine((env, ctx) => {
    const entries = Object.keys(env).length;
    if (entries > WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `Env cannot define more than ${WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES} entries.`,
      });
    }

    const serializedBytes = utf8Encoder.encode(JSON.stringify(env)).byteLength;
    if (serializedBytes > WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `Env cannot serialize to more than ${WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES} bytes.`,
      });
    }
  })
  .meta({
    description: `Environment variables as string, number, or boolean values. Each map allows up to ${WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES} entries and ${WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES} serialized bytes.`,
  });

const workflowDocumentStepOutputKeyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const workflowDocumentStepOutputTypeSchema = z.enum(workflowDocumentStepOutputTypes).meta({
  description: 'Declared output type. Use `json` when the output has a JSON Schema.',
});

const workflowDocumentStepOutputDeclarationSchema = z
  .union([
    workflowDocumentStepOutputTypeSchema.transform((type) => ({type})),
    z.strictObject({
      type: workflowDocumentStepOutputTypeSchema,
      schema: z
        .unknown()
        .optional()
        .meta({
          description:
            'JSON Schema for a `json` output. It allows up to ' +
            WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES +
            ' serialized bytes and ' +
            WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH +
            ' nesting levels.',
        }),
    }),
  ])
  .superRefine((declaration, ctx) => {
    const schema = 'schema' in declaration ? declaration.schema : undefined;
    if (declaration.type !== 'json' && schema !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: '`schema` is only supported for json outputs.',
      });
      return;
    }

    if (schema === undefined) return;

    if (!isJsonSchemaDocument(schema)) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: 'Schema must be a valid JSON Schema document.',
      });
      return;
    }

    const serializedBytes = utf8Encoder.encode(JSON.stringify(schema)).byteLength;
    if (serializedBytes > WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: `Output JSON Schema cannot serialize to more than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES} bytes.`,
      });
    }

    const depth = maxJsonDepth(schema);
    if (depth > WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: `Output JSON Schema cannot be nested deeper than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH} levels.`,
      });
    }
  });

export const workflowDocumentStepOutputsSchema = z
  .record(z.string(), workflowDocumentStepOutputDeclarationSchema)
  .superRefine((outputs, ctx) => {
    const entries = Object.keys(outputs).length;
    if (entries > WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `Step outputs cannot define more than ${WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES} entries.`,
      });
    }

    for (const key of Object.keys(outputs)) {
      if (workflowDocumentStepOutputKeyPattern.test(key)) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'Output keys must be CEL identifiers.',
      });
    }
  })
  .meta({
    description: `Named step outputs. Keys must be CEL identifiers and each step allows up to ${WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES} declarations.`,
  });

const workflowDocumentTriggerBaseSchema = {
  source: z.string().min(1).meta({
    description:
      'Integration connection slug or built-in trigger source. See [Trigger sources](/reference/trigger-sources).',
  }),
  with: z.record(z.string(), z.unknown()).optional().meta({
    description:
      'Provider-specific values used to match or configure the trigger. See [Trigger sources](/reference/trigger-sources).',
  }),
  filter: z.string().min(1).optional().meta({
    description:
      'CEL condition that filters matching events. It is not supported for `manual` or `cron` triggers. See [Expressions](/reference/expressions) and [Contexts](/reference/contexts#context-availability).',
  }),
  config: z.record(z.string(), z.unknown()).optional().meta({
    description:
      'Source-specific configuration. It is supported only for top-level triggers with a known built-in source. See [cron triggers](/reference/trigger-sources#cron).',
  }),
} satisfies z.ZodRawShape;

export const triggerSourceConfigSchemas = {
  cron: z.strictObject({
    schedule: z.string().min(1).optional().meta({
      description: 'Cron expression that schedules the workflow.',
    }),
    timezone: z.string().min(1).optional().meta({
      description: 'IANA time zone used to evaluate `schedule`.',
    }),
  }),
} satisfies Record<string, z.ZodType>;
const triggerSourceConfigSchemaRegistry: Readonly<Record<string, z.ZodType>> =
  triggerSourceConfigSchemas;

export const workflowDocumentTriggerSchema = z
  .strictObject({
    ...workflowDocumentTriggerBaseSchema,
    event: z.string().min(1).meta({
      description: 'Provider event name that starts the workflow.',
    }),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.config === undefined) return;

    const configSchema = triggerSourceConfigSchemaRegistry[trigger.source];
    if (configSchema === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['config'],
        message: `\`config\` is not supported for source \`${trigger.source}\`.`,
      });
      return;
    }

    const configResult = configSchema.safeParse(trigger.config);
    if (configResult.success) return;

    for (const configIssue of configResult.error.issues) {
      ctx.addIssue({
        ...configIssue,
        path: ['config', ...configIssue.path],
      });
    }
  });

const workflowDocumentListeningSchema = z
  .strictObject({
    on: z.array(workflowDocumentTriggerSchema).min(1).meta({
      description: 'Events that start listening. Listening triggers cannot use `config`.',
    }),
    until: z.array(workflowDocumentTriggerSchema).min(1).optional().meta({
      description:
        'Events that resolve listening. Listening jobs need this, `timeout`, or `max_executions`; these triggers cannot use `config`.',
    }),
    timeout: z.string().min(1).optional().meta({
      description:
        'Maximum duration to listen before resolving. A listening job needs this, `until`, or `max_executions`.',
    }),
    max_executions: z.number().int().positive().optional().meta({
      description:
        'Maximum number of matching events before resolving. A listening job needs this, `until`, or `timeout`.',
    }),
    batch: z
      .strictObject({
        debounce: z.string().min(1).optional().meta({
          description: 'Quiet period to wait for more matching events before processing a batch.',
        }),
        max_size: z.number().int().positive().optional().meta({
          description: 'Maximum number of matching events in one batch.',
        }),
        max_wait: z.string().min(1).optional().meta({
          description: 'Maximum time to wait before processing a partial batch.',
        }),
      })
      .refine(
        (value) =>
          value.debounce !== undefined ||
          value.max_size !== undefined ||
          value.max_wait !== undefined,
        {message: 'Expected debounce, max_size, or max_wait'},
      )
      .optional()
      .meta({
        description:
          'Optional batching policy. Set at least one of `debounce`, `max_size`, or `max_wait`.',
      }),
    on_resolve: z.enum(['finish', 'cancel']).optional().meta({
      description: 'How the job resolves when its listening condition is met.',
    }),
  })
  .superRefine((listening, ctx) => {
    for (const field of ['on', 'until'] as const) {
      for (const [index, trigger] of (listening[field] ?? []).entries()) {
        if (trigger.config !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field, index, 'config'],
            message: '`config` is only supported on top-level triggers.',
          });
        }
      }
    }
  });

const workflowDocumentStepGateSchema = z
  .strictObject({
    success: z.string().min(1).optional().meta({
      description:
        'CEL expression that must evaluate to true for the step to succeed. See [gate outcomes](/understand/feedback-loops#gate-outcomes).',
    }),
    on_failure: z
      .strictObject({
        restart_from: z.string().min(1).meta({
          description:
            'Key of an earlier step in the same job to restart from after a failed gate.',
        }),
        feedback: z.string().min(1).optional().meta({
          description: 'Feedback supplied when the gate fails before restarting.',
        }),
      })
      .optional()
      .meta({
        description:
          'Restart behavior when the success gate fails. See [feedback loops](/understand/feedback-loops).',
      }),
  })
  .refine((value) => value.success !== undefined || value.on_failure !== undefined, {
    message: 'Expected success or on_failure',
  });

const workflowDocumentCheckoutPermissionsSchema = z
  .strictObject({
    contents: z.enum(['read', 'write']).optional().meta({
      description: 'Repository contents permission granted to checkout.',
    }),
  })
  .optional()
  .meta({
    description: 'Repository permissions used during checkout.',
  });

const workflowDocumentPersistCredentialsSchema = z.boolean().optional().meta({
  description: 'Whether checkout credentials remain available to later run steps.',
});

export const workflowDocumentCheckoutSchema = z
  .strictObject({
    project: z.string().min(1).optional().meta({
      description: 'Shipfox project id to check out. Exclusive with connection and repository.',
    }),
    connection: z.string().min(1).optional().meta({
      description: 'Integration connection slug to use for checkout.',
    }),
    repository: z.string().min(1).optional().meta({
      description: 'Repository to check out, as owner/name or a bare name.',
    }),
    ref: z.string().min(1).optional().meta({
      description: 'Repository ref to check out.',
    }),
    'fetch-depth': z.number().int().min(0).optional().meta({
      description: 'Number of commits to fetch. Use 0 for full history.',
    }),
    path: z.string().min(1).optional().meta({
      description: 'Relative path under the job workspace where this repository is checked out.',
    }),
    permissions: workflowDocumentCheckoutPermissionsSchema,
    'persist-credentials': workflowDocumentPersistCredentialsSchema,
    force: z.boolean().optional().meta({
      description: 'Whether checkout may replace an occupied destination.',
    }),
  })
  .superRefine((checkout, ctx) => {
    for (const validationIssue of checkoutTargetValidationIssues(checkout)) {
      const message =
        validationIssue.kind === 'project-with-connection'
          ? '"connection" cannot be combined with "project".'
          : validationIssue.kind === 'project-with-repository'
            ? '"repository" cannot be combined with "project".'
            : '"connection" requires "repository".';
      ctx.addIssue({
        code: 'custom',
        path: [validationIssue.path],
        message,
      });
    }
  });

const workflowDocumentJobCheckoutSchema = z
  .union([
    z.strictObject({
      permissions: workflowDocumentCheckoutPermissionsSchema,
      'persist-credentials': workflowDocumentPersistCredentialsSchema,
    }),
    z.literal(false),
  ])
  .meta({
    description:
      'Checkout settings for repository content and credentials, or false to skip checkout.',
  });

export const workflowDocumentStepIntegrationSelectionSchema = z.array(z.string().min(1)).min(1);

export const workflowDocumentStepIntegrationSchema = z.strictObject({
  connection: z.string().min(1).optional().meta({
    description: 'Integration connection slug to use for these tools.',
  }),
  include: workflowDocumentStepIntegrationSelectionSchema.meta({
    description: 'Tool selectors to make available to the agent.',
  }),
  exclude: workflowDocumentStepIntegrationSelectionSchema.optional().meta({
    description: 'Tool selectors to remove from the included tools.',
  }),
  allow_write: z.boolean().optional().meta({
    description: 'Allows write-capable integration tools. Omit or set false for read-only access.',
  }),
});

export const workflowDocumentAgentStepFields = [
  'model',
  'prompt',
  'harness',
  'thinking',
  'provider',
  'tools',
  'integrations',
] as const;

// A step is a run step (`run`), an inline agent step (`prompt`), or a checkout
// step (`checkout`), never two kinds at once. They share one strict object so
// an unknown key is still rejected; the `superRefine` discriminates by which
// payload keys are present and emits one targeted issue per failure mode (a
// plain union would surface every branch's errors at once). The `agent`
// keyword is declared only so the reserved-keyword case produces a clear
// message instead of a generic "unrecognized key".
export const workflowDocumentStepSchema = z
  .strictObject({
    key: z
      .string()
      .min(1)
      .optional()
      .meta({description: 'Stable step key for dependencies and outputs.'}),
    if: z
      .string()
      .min(1)
      .optional()
      .meta({
        description:
          'CEL condition wrapped in exactly one $' +
          '{{ }} interpolation. See [conditionals](/reference/expressions#syntax).',
      }),
    name: z.string().min(1).optional().meta({description: 'Human-readable step name.'}),
    working_directory: z.string().min(1).optional().meta({
      description: 'Working directory for the step, relative to the job workspace.',
    }),
    run: z.string().min(1).optional().meta({
      description: 'Shell command for a run step. Do not combine it with agent-only fields.',
    }),
    checkout: workflowDocumentCheckoutSchema.optional().meta({
      description: 'Repository checkout settings for this step.',
    }),
    model: z.string().min(1).optional().meta({
      description:
        'Model ID for an agent step. It requires `prompt` and is not valid on a run step.',
    }),
    prompt: z.string().min(1).optional().meta({
      description: 'Prompt for an agent step. It is required when any agent-only field is set.',
    }),
    harness: harnessSchema.optional().meta({
      description:
        'Agent harness. When omitted, Shipfox uses the workspace default harness, or `pi` when none is configured.',
    }),
    thinking: agentThinkingFieldSchema.optional(),
    provider: z.string().min(1).optional().meta({
      description:
        'Model provider ID for an agent step. It requires `prompt` and is not valid on a run step.',
    }),
    tools: z.array(z.string().min(1)).min(1).optional().meta({
      description:
        'Built-in tool IDs for an agent step. It requires `prompt` and is not valid on a run step.',
    }),
    integrations: z.array(workflowDocumentStepIntegrationSchema).min(1).optional().meta({
      description:
        'Integration tools available to an agent step. It requires `prompt` and is not valid on a run step. See [integration tools](/how-to/author-workflows/use-integration-tools).',
    }),
    agent: z.unknown().optional().meta({
      description: 'Reserved keyword. It is rejected; use `prompt` to define an agent step.',
    }),
    gate: workflowDocumentStepGateSchema.optional().meta({
      description: 'Success gate and optional restart behavior after the step runs.',
    }),
    env: workflowDocumentEnvSchema.optional().meta({
      description: 'Environment variables for a run step. They are not valid on an agent step.',
    }),
    outputs: workflowDocumentStepOutputsSchema.optional().meta({
      description: 'Named output declarations produced by this step.',
    }),
  })
  .superRefine((step, ctx) => {
    if (step.agent !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['agent'],
        message: 'The "agent" keyword is reserved for a future step kind and is not supported yet.',
      });
      return;
    }

    if (step.checkout !== undefined) {
      if (step.run !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['run'],
          message: '"run" is not valid on a checkout step.',
        });
      }
      for (const key of workflowDocumentAgentStepFields) {
        if (step[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `"${key}" is not valid on a checkout step.`,
          });
        }
      }
      if (step.env !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['env'],
          message: '"env" is not valid on a checkout step.',
        });
      }
      return;
    }

    if (step.run !== undefined) {
      for (const key of workflowDocumentAgentStepFields) {
        if (step[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `"${key}" is not valid on a run step.`,
          });
        }
      }
      return;
    }

    const isAgent = workflowDocumentAgentStepFields.some((field) => step[field] !== undefined);

    if (!isAgent) {
      ctx.addIssue({
        code: 'custom',
        message: 'A step must define either "run", an agent "prompt", or "checkout".',
      });
      return;
    }

    if (step.env !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['env'],
        message: '"env" is supported only on run steps.',
      });
    }
    if (step.prompt === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['prompt'],
        message: 'An agent step requires "prompt".',
      });
    }
  });

export const workflowDocumentJobSchema = z.strictObject({
  needs: stringOrStringArraySchema.optional().meta({
    description: 'Job key or keys that must complete before this job starts.',
  }),
  if: z
    .string()
    .min(1)
    .optional()
    .meta({
      description:
        'CEL condition wrapped in exactly one $' +
        '{{ }} interpolation. See [conditionals](/reference/expressions#syntax).',
    }),
  runner: stringOrStringArraySchema.optional().meta({
    description:
      'Runner label or ordered fallback labels for this job. See [runners and execution environments](/understand/runners-and-execution-environments).',
  }),
  success: z.string().min(1).optional().meta({
    description:
      'CEL expression that determines whether the job succeeds. See [Expressions](/reference/expressions#functions-and-macros) and [Contexts](/reference/contexts#context-availability).',
  }),
  outputs: nonEmptyRecordSchema(z.string().min(1)).optional().meta({
    description: 'Named job outputs mapped from step values.',
  }),
  execution_timeout: z.string().min(1).optional().meta({
    description: 'Maximum duration for one job execution.',
  }),
  checkout: workflowDocumentJobCheckoutSchema.optional(),
  listening: workflowDocumentListeningSchema.optional().meta({
    description:
      'Event-listening configuration for this job. See [listening jobs](/understand/listening-jobs).',
  }),
  name: jobNameSchema.optional(),
  execution_name: z.string().min(1).optional().meta({
    description: 'Dynamic name for each job execution. Supports workflow expressions.',
  }),
  env: workflowDocumentEnvSchema.optional().meta({
    description:
      'Environment variables for run steps in this job. They do not apply to agent steps. See [secrets and variables](/reference/secrets-variables).',
  }),
  steps: z.array(workflowDocumentStepSchema).min(1).meta({
    description: 'Ordered run or agent steps. Each job needs at least one step.',
  }),
});

export const workflowDocumentSchema = z.strictObject({
  name: workflowNameSchema,
  run_name: z.string().min(1).optional().meta({
    description: 'Dynamic name for each workflow run. Supports workflow expressions.',
  }),
  runner: stringOrStringArraySchema.optional().meta({
    description:
      'Default runner label or ordered fallback labels for run jobs. See [runners and execution environments](/understand/runners-and-execution-environments).',
  }),
  env: workflowDocumentEnvSchema.optional().meta({
    description:
      'Workflow-level environment variables for run steps. They do not apply to agent steps. See [secrets and variables](/reference/secrets-variables).',
  }),
  triggers: nonEmptyRecordSchema(workflowDocumentTriggerSchema).optional().meta({
    description:
      'Named events that start workflow runs. A workflow can have at most one `manual` trigger.',
  }),
  jobs: nonEmptyRecordSchema(workflowDocumentJobSchema).meta({
    description: 'Named jobs that make up the workflow. At least one job is required.',
  }),
});

export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type WorkflowDocumentCheckout = z.infer<typeof workflowDocumentCheckoutSchema>;
export type WorkflowDocumentJobCheckout = z.infer<typeof workflowDocumentJobCheckoutSchema>;
export type WorkflowDocumentEnv = z.infer<typeof workflowDocumentEnvSchema>;
export type WorkflowDocumentJob = z.infer<typeof workflowDocumentJobSchema>;
export type WorkflowDocumentJobListening = z.infer<typeof workflowDocumentListeningSchema>;
export type WorkflowDocumentRunStepGate = z.infer<typeof workflowDocumentStepGateSchema>;
export type WorkflowDocumentStepIntegration = z.infer<typeof workflowDocumentStepIntegrationSchema>;
export type WorkflowDocumentStepOutputType = (typeof workflowDocumentStepOutputTypes)[number];
export type WorkflowDocumentStepOutputs = z.infer<typeof workflowDocumentStepOutputsSchema>;
export type WorkflowDocumentStep = z.infer<typeof workflowDocumentStepSchema>;
export type WorkflowDocumentTrigger = z.infer<typeof workflowDocumentTriggerSchema>;

function maxJsonDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    return 1 + Math.max(...value.map(maxJsonDepth));
  }

  const entries = Object.values(value);
  if (entries.length === 0) return 1;
  return 1 + Math.max(...entries.map(maxJsonDepth));
}

function isJsonSchemaDocument(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}
