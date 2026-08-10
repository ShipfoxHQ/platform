import {providerRunnerStateSchema} from '@shipfox/api-runners-dto';
import type {RunnerInstanceState} from '#core/entities/runner-instance.js';

export const activeStates = [
  'starting',
  'running',
  'stopping',
] as const satisfies readonly RunnerInstanceState[];

export const terminalStates = providerRunnerStateSchema.options.filter(
  (state) => !activeStates.includes(state as (typeof activeStates)[number]),
) as readonly Extract<RunnerInstanceState, 'stopped' | 'failed' | 'terminated'>[];
