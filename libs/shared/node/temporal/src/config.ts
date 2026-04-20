import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  TEMPORAL_ADDRESS: str({default: 'localhost:7233'}),
  TEMPORAL_NAMESPACE: str({default: 'default'}),
  TEMPORAL_TASK_QUEUE: str({default: 'shipfox'}),
});
