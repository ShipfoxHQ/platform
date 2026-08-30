import type {DemandStatDto} from '@shipfox/api-runners-dto';
import {getServiceMetricsProvider, logger, type ObservableGauge} from '@shipfox/node-opentelemetry';
import {type ProvisionerTemplate, rankTemplatesForLabels} from '@shipfox/provisioner-core';
import type {Ec2Engine, Ec2InstanceState, Ec2InstanceView} from '#ec2-engine.js';
import {parseInstanceIdentity} from '#instance-identity.js';
import type {Ec2TemplateSpec} from '#templates.js';

type ServiceMetricLabels = {
  template_key?: string;
  state?: Ec2InstanceState | 'starting' | 'running';
};
type TemplateRunnerCounts = {starting: number; running: number};
type TemplateDemand = {queued: number; oldestQueuedAtMs?: number};
interface BatchMetricObserver {
  observe(
    gauge: ObservableGauge<ServiceMetricLabels>,
    value: number,
    labels?: ServiceMetricLabels,
  ): void;
}

export interface RegisterEc2ServiceMetricsOptions {
  readonly engine: Ec2Engine;
  readonly provisionerId: string;
  readonly templates: readonly ProvisionerTemplate<Ec2TemplateSpec>[];
  readonly getDemandStats: () => readonly DemandStatDto[];
}

export function registerEc2ServiceMetrics(options: RegisterEc2ServiceMetricsOptions): void {
  const meter = getServiceMetricsProvider().getMeter('provisioner-ec2');
  const managedInstances = meter.createObservableGauge<ServiceMetricLabels>(
    'ec2_provisioner_managed_instances',
    {
      description: 'EC2 runner instances currently managed by the provisioner, by EC2 state',
    },
  );
  const templateRunners = meter.createObservableGauge<ServiceMetricLabels>(
    'ec2_provisioner_template_runners',
    {description: 'EC2 runner instances charged against each template concurrency cap'},
  );
  const templateMaxConcurrency = meter.createObservableGauge<ServiceMetricLabels>(
    'ec2_provisioner_template_max_concurrency',
    {description: 'Configured maximum concurrency for each EC2 runner template'},
  );
  const templateTargetConcurrency = meter.createObservableGauge<ServiceMetricLabels>(
    'ec2_provisioner_template_target_concurrency',
    {description: 'Configured warm-pool target concurrency for each EC2 runner template'},
  );
  const templateQueuedDemand = meter.createObservableGauge<ServiceMetricLabels>(
    'ec2_provisioner_template_queued_demand',
    {description: 'Queued jobs matching each EC2 runner template'},
  );
  const templateOldestQueuedAge = meter.createObservableGauge<ServiceMetricLabels>(
    'ec2_provisioner_template_oldest_queued_age',
    {
      description: 'Age of the oldest queued job matching each EC2 runner template',
      unit: 'ms',
    },
  );
  let lastUnattributedCount = 0;

  meter.addBatchObservableCallback(
    async (observer) => {
      try {
        const instances = await options.engine.listManaged(options.provisionerId);
        observeManagedInstanceCounts(observer, managedInstances, instances);
        const {countsByTemplate, unattributedCount} = countTemplateRunners(
          options.templates,
          instances,
        );
        if (unattributedCount !== 0 && unattributedCount !== lastUnattributedCount) {
          logger().warn(
            {
              event: 'provisioner.ec2.unattributed_managed_instances',
              count: unattributedCount,
              provisionerId: options.provisionerId,
            },
            'Some managed EC2 instances do not map to a configured template',
          );
        }
        lastUnattributedCount = unattributedCount;
        const demandByTemplate = calculateTemplateDemand(options);
        observeTemplateMetrics(observer, options.templates, countsByTemplate, demandByTemplate, {
          templateRunners,
          templateMaxConcurrency,
          templateTargetConcurrency,
          templateQueuedDemand,
          templateOldestQueuedAge,
        });
      } catch (error) {
        logger().warn(
          {
            event: 'provisioner.ec2.service_metrics_failed',
            provisionerId: options.provisionerId,
            reason: errorReason(error),
          },
          'EC2 service metrics callback failed',
        );
      }
    },
    [
      managedInstances,
      templateRunners,
      templateMaxConcurrency,
      templateTargetConcurrency,
      templateQueuedDemand,
      templateOldestQueuedAge,
    ],
  );
}

function observeManagedInstanceCounts(
  observer: BatchMetricObserver,
  gauge: ObservableGauge<ServiceMetricLabels>,
  instances: readonly Ec2InstanceView[],
): void {
  const counts = new Map<Ec2InstanceState, number>();
  for (const instance of instances)
    counts.set(instance.state, (counts.get(instance.state) ?? 0) + 1);
  for (const [state, count] of counts) observer.observe(gauge, count, {state});
}

function countTemplateRunners(
  templates: RegisterEc2ServiceMetricsOptions['templates'],
  instances: readonly Ec2InstanceView[],
): {countsByTemplate: Map<string, TemplateRunnerCounts>; unattributedCount: number} {
  const countsByTemplate = new Map<string, TemplateRunnerCounts>(
    templates.map((template) => [template.key, {starting: 0, running: 0}]),
  );
  let unattributedCount = 0;
  for (const instance of instances) {
    const templateKey = parseInstanceIdentity(instance).templateKey;
    if (!templateKey || !countsByTemplate.has(templateKey)) {
      unattributedCount += 1;
      continue;
    }
    const state = templateRunnerState(instance.state);
    if (!state) continue;
    const templateCounts = countsByTemplate.get(templateKey);
    if (templateCounts) templateCounts[state] += 1;
  }
  return {countsByTemplate, unattributedCount};
}

function calculateTemplateDemand(
  options: RegisterEc2ServiceMetricsOptions,
): Map<string, TemplateDemand> {
  const demandByTemplate = new Map<string, TemplateDemand>(
    options.templates.map((template) => [template.key, {queued: 0}]),
  );
  for (const stat of options.getDemandStats()) {
    if (stat.queued === 0) continue;
    const oldestQueuedAtMs = Date.parse(stat.oldest_queued_at);
    for (const template of rankTemplatesForLabels(stat.labels, options.templates)) {
      const demand = demandByTemplate.get(template.key);
      if (!demand) continue;
      demand.queued += stat.queued;
      if (Number.isFinite(oldestQueuedAtMs)) {
        demand.oldestQueuedAtMs =
          demand.oldestQueuedAtMs === undefined
            ? oldestQueuedAtMs
            : Math.min(demand.oldestQueuedAtMs, oldestQueuedAtMs);
      }
    }
  }
  return demandByTemplate;
}

interface TemplateMetricGauges {
  templateRunners: ObservableGauge<ServiceMetricLabels>;
  templateMaxConcurrency: ObservableGauge<ServiceMetricLabels>;
  templateTargetConcurrency: ObservableGauge<ServiceMetricLabels>;
  templateQueuedDemand: ObservableGauge<ServiceMetricLabels>;
  templateOldestQueuedAge: ObservableGauge<ServiceMetricLabels>;
}

function observeTemplateMetrics(
  observer: BatchMetricObserver,
  templates: RegisterEc2ServiceMetricsOptions['templates'],
  countsByTemplate: ReadonlyMap<string, TemplateRunnerCounts>,
  demandByTemplate: ReadonlyMap<string, TemplateDemand>,
  gauges: TemplateMetricGauges,
): void {
  for (const template of templates) {
    const labels = {template_key: template.key};
    const counts = countsByTemplate.get(template.key) ?? {starting: 0, running: 0};
    const demand = demandByTemplate.get(template.key) ?? {queued: 0};
    observer.observe(gauges.templateRunners, counts.starting, {...labels, state: 'starting'});
    observer.observe(gauges.templateRunners, counts.running, {...labels, state: 'running'});
    observer.observe(gauges.templateMaxConcurrency, template.maxConcurrency, labels);
    observer.observe(gauges.templateTargetConcurrency, template.targetConcurrency ?? 0, labels);
    observer.observe(gauges.templateQueuedDemand, demand.queued, labels);
    const oldestAge =
      demand.oldestQueuedAtMs === undefined ? 0 : Math.max(0, Date.now() - demand.oldestQueuedAtMs);
    observer.observe(gauges.templateOldestQueuedAge, oldestAge, labels);
  }
}

function templateRunnerState(state: Ec2InstanceState): 'starting' | 'running' | undefined {
  switch (state) {
    case 'pending':
      return 'starting';
    case 'running':
      return 'running';
    case 'unknown':
      return 'running';
    default:
      return undefined;
  }
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
