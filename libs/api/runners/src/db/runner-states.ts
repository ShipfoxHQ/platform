import type {RunnerInstanceState} from '#core/entities/runner-instance.js';

export const terminalStates = [
  'stopped',
  'failed',
  'terminated',
] as const satisfies readonly RunnerInstanceState[];
