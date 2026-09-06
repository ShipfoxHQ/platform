import {
  defineWorktreeServices,
  standardAppEnv,
  standardPorts,
} from '@shipfox/worktree-services';

export default defineWorktreeServices({
  composeFile: 'compose.yml',
  ports: standardPorts,
  compose: {
    services: ['postgres', 'temporal', 'garage', 'gitea'],
    initCommands: ['garage-init', 'gitea-init'],
  },
  appEnv({ports}) {
    return {
      ...standardAppEnv(ports),
      API_PORT: String(ports.api),
      API_PUBLIC_URL: `http://localhost:${ports.api}`,
      CLIENT_BASE_URL: `http://localhost:${ports.client}`,
      VITE_API_URL: `http://localhost:${ports.api}`,
    };
  },
});
