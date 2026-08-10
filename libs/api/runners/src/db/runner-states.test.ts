import {providerRunnerStateSchema} from '@shipfox/api-runners-dto';
import {activeStates, terminalStates} from '#db/runner-states.js';

describe('runner state partitions', () => {
  it('covers every provider state exactly once', () => {
    const states = [...activeStates, ...terminalStates];

    expect(new Set(states).size).toBe(states.length);
    expect([...states].sort()).toEqual([...providerRunnerStateSchema.options].sort());
    expect([...terminalStates]).toEqual(
      providerRunnerStateSchema.options.filter(
        (state) => !activeStates.includes(state as (typeof activeStates)[number]),
      ),
    );
  });
});
