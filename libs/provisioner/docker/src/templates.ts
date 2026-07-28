import {readFileSync} from 'node:fs';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type ProvisionerTemplate,
  type ProvisionerTemplateFile,
  parseTemplateFile,
  type RenderedTemplateMap,
  renderTemplateVariants,
} from '@shipfox/provisioner-core';
import {canonicalizeLabels, findInvalidLabels, MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import yaml from 'js-yaml';
import {z} from 'zod';
import {MEMORY_PATTERN} from '#memory.js';

/** Docker-specific launch details the launcher needs to run one runner container. */
export interface DockerTemplateSpec {
  readonly image: string;
  readonly cpu: number;
  readonly memory: string;
}

export const DEFAULT_RUNNER_IMAGE = 'ghcr.io/shipfoxhq/runner:latest';
/** Raised when the template config file is missing, unparseable, or invalid. */
export class DockerTemplateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerTemplateConfigError';
  }
}

const MAX_TEMPLATE_CONCURRENCY = 100_000;

const dockerTemplateSchema = z
  .object({
    labels: z.array(z.string()).min(1),
    image: z.string().trim().min(1).default(DEFAULT_RUNNER_IMAGE),
    cpu: z.number().positive(),
    memory: z.string().regex(MEMORY_PATTERN, 'must be a size like "4GiB", "512m", "2g", or "512"'),
    max_concurrency: z.number().int().positive().max(MAX_TEMPLATE_CONCURRENCY),
    target_concurrency: z.number().int().min(0).max(MAX_TEMPLATE_CONCURRENCY).default(0),
    cost: z.number().positive().optional(),
  })
  .strict();

const dockerTemplatesFileSchema = z
  .object({
    templates: z.record(z.string().min(1), dockerTemplateSchema),
  })
  .strict();

/**
 * Read, parse, and validate the local Docker template config, returning the
 * provider-agnostic templates the control loop drives. Fails fast with a clear,
 * file-scoped error on any problem: missing file, malformed YAML, a field that does
 * not validate, an invalid label, or an empty template set.
 */
export function loadDockerTemplates(filePath: string): ProvisionerTemplate<DockerTemplateSpec>[] {
  const raw = parseYamlFile(filePath);
  let templateFile: ProvisionerTemplateFile;
  let renderedTemplates: RenderedTemplateMap;
  try {
    templateFile = parseTemplateFile(raw);
    renderedTemplates = renderTemplateVariants(templateFile);
  } catch (error) {
    throw new DockerTemplateConfigError(
      `Invalid Docker template config at ${filePath}: ${errorMessage(error)}`,
    );
  }

  const parsed = dockerTemplatesFileSchema.safeParse({templates: renderedTemplates});
  if (!parsed.success) {
    throw new DockerTemplateConfigError(
      `Invalid Docker template config at ${filePath}: ${formatIssues(parsed.error)}`,
    );
  }

  const entries = Object.entries(parsed.data.templates);
  if (entries.length === 0) {
    throw new DockerTemplateConfigError(
      `Docker template config at ${filePath} declares no templates; add at least one.`,
    );
  }

  const templates = entries.map(([key, spec]) => {
    if (!hasImageField(renderedTemplates, key)) {
      logger().debug?.(
        {
          event: 'runner.default_image_selected',
          filePath,
          templateKey: key,
          image: spec.image,
        },
        'Docker template omitted image; selected ghcr.io/shipfoxhq/runner:latest as the default runner image',
      );
    }
    return toTemplate(filePath, key, spec);
  });

  const familyCount = Object.keys(templateFile.matrix ?? {}).length;
  logger().info(
    {
      event: 'provisioner.templates_loaded',
      filePath,
      templateCount: templates.length,
      familyCount,
    },
    `Loaded ${templates.length} Docker templates from ${familyCount} matrix families`,
  );

  return templates;
}

function hasImageField(templates: Readonly<Record<string, unknown>>, key: string): boolean {
  const template = templates[key];
  return isRecord(template) && Object.hasOwn(template, 'image');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toTemplate(
  filePath: string,
  key: string,
  spec: z.infer<typeof dockerTemplateSchema>,
): ProvisionerTemplate<DockerTemplateSpec> {
  const labels = canonicalizeLabels(spec.labels);
  if (labels.length === 0) {
    throw new DockerTemplateConfigError(
      `Template "${key}" in ${filePath} has no usable labels after normalization.`,
    );
  }
  if (labels.length > MAX_RUNNER_LABELS) {
    throw new DockerTemplateConfigError(
      `Template "${key}" in ${filePath} has ${labels.length} labels; the maximum is ${MAX_RUNNER_LABELS}.`,
    );
  }
  const invalid = findInvalidLabels(labels);
  if (invalid.length > 0) {
    throw new DockerTemplateConfigError(
      `Template "${key}" in ${filePath} has invalid labels: ${invalid.join(', ')}.`,
    );
  }

  return {
    key,
    labels,
    maxConcurrency: spec.max_concurrency,
    targetConcurrency: spec.target_concurrency,
    // Explicit costs control selection; omitted costs fall back to the vCPU count.
    cost: spec.cost ?? spec.cpu,
    spec: {image: spec.image, cpu: spec.cpu, memory: spec.memory},
  };
}

function parseYamlFile(filePath: string): unknown {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new DockerTemplateConfigError(
      `Cannot read Docker template config at ${filePath}: ${errorMessage(error)}`,
    );
  }

  try {
    return yaml.load(contents);
  } catch (error) {
    throw new DockerTemplateConfigError(
      `Cannot parse Docker template config at ${filePath}: ${errorMessage(error)}`,
    );
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
