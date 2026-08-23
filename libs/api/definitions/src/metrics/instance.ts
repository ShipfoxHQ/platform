import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {DefinitionAtRefErrorCode} from '#core/errors.js';

const meter = instanceMetrics.getMeter('definitions');

export type DefinitionRefResolutionOutcome = DefinitionAtRefErrorCode | 'resolved';

const refResolutionCount = meter.createCounter<{outcome: DefinitionRefResolutionOutcome}>(
  'definitions_ref_resolutions',
  {description: 'Workflow definition resolutions at a git ref by outcome'},
);

export function recordDefinitionRefResolution(outcome: DefinitionRefResolutionOutcome): void {
  refResolutionCount.add(1, {outcome});
}
