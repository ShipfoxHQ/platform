import type {ProviderRunnerLaunch, ProvisionerIdentity} from '@shipfox/provisioner-core';
import {canonicalizeLabels, parseLabelList} from '@shipfox/runner-labels';
import type {Ec2TemplateSpec} from '#templates.js';

export const SHIPFOX_TAGS = {
  runnerInstanceId: 'shipfox.runner_instance_id',
  providerRunnerId: 'shipfox.provider_runner_id',
  provisionerId: 'shipfox.provisioner_id',
  // Immutable launch origin; the backend assignment can change when it rebinds a runner.
  reservationId: 'shipfox.reservation_id',
  templateKey: 'shipfox.template_key',
  workspaceId: 'shipfox.workspace_id',
  labels: 'shipfox.labels',
} as const;

export interface ParsedInstanceIdentity {
  readonly runnerInstanceId?: string;
  readonly providerRunnerId: string;
  readonly provisionerId?: string;
  readonly reservationId?: string;
  readonly templateKey?: string;
  readonly workspaceId?: string;
  readonly labels: readonly string[];
}

export function buildInstanceTags(args: {
  launch: ProviderRunnerLaunch<Ec2TemplateSpec>;
  identity: ProvisionerIdentity;
}): Record<string, string> {
  return {
    [SHIPFOX_TAGS.runnerInstanceId]: args.launch.runnerInstanceId,
    [SHIPFOX_TAGS.providerRunnerId]: args.launch.providerRunnerId,
    [SHIPFOX_TAGS.provisionerId]: args.identity.id,
    ...(args.launch.reservationId ? {[SHIPFOX_TAGS.reservationId]: args.launch.reservationId} : {}),
    [SHIPFOX_TAGS.templateKey]: args.launch.template.key,
    ...(args.identity.workspaceId ? {[SHIPFOX_TAGS.workspaceId]: args.identity.workspaceId} : {}),
    [SHIPFOX_TAGS.labels]: args.launch.template.labels.join(','),
    Name: args.launch.providerRunnerId,
  };
}

export function parseInstanceIdentity(view: {
  tags: Readonly<Record<string, string>>;
}): ParsedInstanceIdentity {
  const providerRunnerId = view.tags[SHIPFOX_TAGS.providerRunnerId] ?? view.tags.Name ?? '';
  const labels = canonicalizeLabels(parseLabelList(view.tags[SHIPFOX_TAGS.labels] ?? ''));

  return {
    ...(view.tags[SHIPFOX_TAGS.runnerInstanceId]
      ? {runnerInstanceId: view.tags[SHIPFOX_TAGS.runnerInstanceId]}
      : {}),
    providerRunnerId,
    ...(view.tags[SHIPFOX_TAGS.provisionerId]
      ? {provisionerId: view.tags[SHIPFOX_TAGS.provisionerId]}
      : {}),
    ...(view.tags[SHIPFOX_TAGS.reservationId]
      ? {reservationId: view.tags[SHIPFOX_TAGS.reservationId]}
      : {}),
    ...(view.tags[SHIPFOX_TAGS.templateKey]
      ? {templateKey: view.tags[SHIPFOX_TAGS.templateKey]}
      : {}),
    ...(view.tags[SHIPFOX_TAGS.workspaceId]
      ? {workspaceId: view.tags[SHIPFOX_TAGS.workspaceId]}
      : {}),
    labels,
  };
}
