import {readFileSync} from 'node:fs';
import {
  type ProvisionerTemplate,
  ProvisionerTemplateFileError,
  parseTemplateFile,
  renderTemplateVariants,
} from '@shipfox/provisioner-core';
import {canonicalizeLabels, findInvalidLabels, MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import yaml from 'js-yaml';
import {z} from 'zod';

export type Ec2Market = 'spot' | 'on-demand';

/** EC2-specific launch details the launcher needs to run one runner instance. */
export interface Ec2TemplateSpec {
  readonly ami: string;
  readonly instanceType: string;
  readonly market: Ec2Market;
  readonly spotMaxPrice: number | null;
  readonly subnets: readonly string[];
  readonly securityGroups: readonly string[];
  readonly associatePublicIp: boolean;
  readonly rootVolumeGb: number;
  readonly rootDeviceName: string;
  readonly workspaceVolumeGb: number;
  readonly workspaceDeviceName: string;
}

/** Raised when the template config file is missing, unparseable, or invalid. */
export class Ec2TemplateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ec2TemplateConfigError';
  }
}

const MAX_TEMPLATE_CONCURRENCY = 100_000;
export const MAX_EC2_TEMPLATES = 256;
export const MAX_TEMPLATE_KEY_LENGTH = 128;
export const UNKNOWN_TEMPLATE_KEY = '__unattributed__';
const TEMPLATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const XVD_DEVICE_ALIAS_PATTERN = /^\/dev\/xvd/i;

const templateKeySchema = z
  .string()
  .trim()
  .min(1, 'must not be blank')
  .max(MAX_TEMPLATE_KEY_LENGTH, `must be at most ${MAX_TEMPLATE_KEY_LENGTH} characters`)
  .regex(
    TEMPLATE_KEY_PATTERN,
    'must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens',
  )
  .refine((key) => key !== UNKNOWN_TEMPLATE_KEY, `is reserved for untagged instances`);

const ec2TemplateSchema = z
  .object({
    labels: z.array(z.string()).min(1),
    ami: z
      .string()
      .trim()
      .regex(/^ami-[0-9a-f]+$/, 'must be an AMI id like "ami-0123456789abcdef0"'),
    instance_type: z.string().trim().min(1),
    market: z.enum(['spot', 'on-demand']),
    spot_max_price: z.number().positive().nullish(),
    subnets: z.array(z.string().trim().min(1)).min(1),
    security_groups: z.array(z.string().trim().min(1)).min(1),
    associate_public_ip: z.boolean(),
    root_volume_gb: z.number().int().positive(),
    root_device_name: z
      .string()
      .trim()
      .regex(/^\/dev\/[A-Za-z0-9]+$/, 'must be an EC2 device name like "/dev/sda1"')
      .optional(),
    workspace_volume_gb: z.number().int().positive().default(100),
    workspace_device_name: z
      .string()
      .trim()
      .regex(/^\/dev\/[A-Za-z0-9]+$/, 'must be an EC2 device name like "/dev/sdf"')
      .default('/dev/sdf'),
    max_concurrency: z.number().int().positive().max(MAX_TEMPLATE_CONCURRENCY),
    target_concurrency: z.number().int().nonnegative().max(MAX_TEMPLATE_CONCURRENCY).optional(),
    cost: z.number().positive(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.market === 'on-demand' && spec.spot_max_price != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spot_max_price'],
        message: 'spot_max_price is only valid when market is "spot".',
      });
    }
    if (
      canonicalEc2DeviceName(spec.root_device_name ?? '/dev/sda1') ===
      canonicalEc2DeviceName(spec.workspace_device_name)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workspace_device_name'],
        message: 'must differ from root_device_name.',
      });
    }
  });

const ec2TemplatesSchema = z.record(z.string().min(1), ec2TemplateSchema);

function canonicalEc2DeviceName(deviceName: string): string {
  return deviceName.toLowerCase().replace(XVD_DEVICE_ALIAS_PATTERN, '/dev/sd');
}

/**
 * Read, parse, and validate the local EC2 template config, returning the
 * provider-agnostic templates the control loop drives. Fails fast with a clear,
 * file-scoped error on any problem: missing file, malformed YAML, a field that does
 * not validate, an invalid label, or an empty template set.
 */
export function loadEc2Templates(filePath: string): ProvisionerTemplate<Ec2TemplateSpec>[] {
  const rendered = renderTemplates(filePath, parseYamlFile(filePath));
  const normalized = normalizeTemplateKeys(filePath, rendered);
  const parsed = ec2TemplatesSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Ec2TemplateConfigError(
      `Invalid EC2 template config at ${filePath}: ${formatIssues(parsed.error)}`,
    );
  }

  const entries = Object.entries(parsed.data);
  if (entries.length === 0) {
    throw new Ec2TemplateConfigError(
      `EC2 template config at ${filePath} declares no templates; add at least one.`,
    );
  }
  if (entries.length > MAX_EC2_TEMPLATES) {
    throw new Ec2TemplateConfigError(
      `EC2 template config at ${filePath} declares ${entries.length} templates; the maximum is ${MAX_EC2_TEMPLATES}.`,
    );
  }

  return entries.map(([key, spec]) => toTemplate(filePath, key, spec));
}

function renderTemplates(filePath: string, raw: unknown): unknown {
  try {
    return renderTemplateVariants(parseTemplateFile(raw));
  } catch (error) {
    if (error instanceof ProvisionerTemplateFileError) {
      throw new Ec2TemplateConfigError(
        `Invalid EC2 template config at ${filePath}: ${error.message}`,
      );
    }
    throw error;
  }
}

function normalizeTemplateKeys(filePath: string, rendered: unknown): unknown {
  if (typeof rendered !== 'object' || rendered === null || Array.isArray(rendered)) {
    return rendered;
  }

  const normalized: Record<string, unknown> = {};
  const originalKeys = new Map<string, string>();
  const issues: string[] = [];
  for (const [rawKey, spec] of Object.entries(rendered)) {
    const parsed = templateKeySchema.safeParse(rawKey);
    if (!parsed.success) {
      issues.push(`template key "${rawKey}": ${formatIssues(parsed.error)}`);
      continue;
    }

    const key = parsed.data;
    const previousRawKey = originalKeys.get(key);
    if (previousRawKey !== undefined) {
      issues.push(
        `template keys "${previousRawKey}" and "${rawKey}" normalize to the same key "${key}"`,
      );
      continue;
    }
    originalKeys.set(key, rawKey);
    Object.defineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value: spec,
      writable: true,
    });
  }

  if (issues.length > 0) {
    throw new Ec2TemplateConfigError(
      `Invalid EC2 template config at ${filePath}: ${issues.join('; ')}`,
    );
  }
  return normalized;
}

function toTemplate(
  filePath: string,
  key: string,
  spec: z.infer<typeof ec2TemplateSchema>,
): ProvisionerTemplate<Ec2TemplateSpec> {
  const labels = canonicalizeLabels(spec.labels);
  if (labels.length === 0) {
    throw new Ec2TemplateConfigError(
      `Template "${key}" in ${filePath} has no usable labels after normalization.`,
    );
  }
  if (labels.length > MAX_RUNNER_LABELS) {
    throw new Ec2TemplateConfigError(
      `Template "${key}" in ${filePath} has ${labels.length} labels; the maximum is ${MAX_RUNNER_LABELS}.`,
    );
  }
  const invalid = findInvalidLabels(labels);
  if (invalid.length > 0) {
    throw new Ec2TemplateConfigError(
      `Template "${key}" in ${filePath} has invalid labels: ${invalid.join(', ')}.`,
    );
  }

  return {
    key,
    labels,
    maxConcurrency: spec.max_concurrency,
    ...(spec.target_concurrency === undefined ? {} : {targetConcurrency: spec.target_concurrency}),
    cost: spec.cost,
    spec: {
      ami: spec.ami,
      instanceType: spec.instance_type,
      market: spec.market,
      spotMaxPrice: spec.spot_max_price ?? null,
      subnets: spec.subnets,
      securityGroups: spec.security_groups,
      associatePublicIp: spec.associate_public_ip,
      rootVolumeGb: spec.root_volume_gb,
      rootDeviceName: spec.root_device_name ?? '/dev/sda1',
      workspaceVolumeGb: spec.workspace_volume_gb,
      workspaceDeviceName: spec.workspace_device_name,
    },
  };
}

function parseYamlFile(filePath: string): unknown {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Ec2TemplateConfigError(
      `Cannot read EC2 template config at ${filePath}: ${errorMessage(error)}`,
    );
  }

  try {
    return yaml.load(contents);
  } catch (error) {
    throw new Ec2TemplateConfigError(
      `Cannot parse EC2 template config at ${filePath}: ${errorMessage(error)}`,
    );
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      if (issue.code === z.ZodIssueCode.unrecognized_keys) {
        const keys = issue.keys
          .map((key) =>
            key === 'iam_instance_profile'
              ? `${key} (remove this field; runner instances must not carry AWS credentials)`
              : key,
          )
          .join(', ');
        return `${path ? `${path}: ` : ''}unrecognized key(s): ${keys}`;
      }
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
