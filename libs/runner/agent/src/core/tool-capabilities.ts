import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {isPiExtensionAvailable} from '#core/pi-extensions.js';

const PI_BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;

const PI_WEB_ACCESS_TOOLS = ['web_search', 'fetch_content', 'get_search_content'] as const;

const CLAUDE_TOOLS = [
  'Read',
  'Bash',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
] as const;

export function runnerToolCapabilities(): RunnerToolCapabilitiesDto {
  const piTools = isPiExtensionAvailable({packageName: 'pi-web-access'})
    ? [...PI_BUILTIN_TOOLS, ...PI_WEB_ACCESS_TOOLS]
    : [...PI_BUILTIN_TOOLS];

  return {
    harnesses: {
      pi: {tools: piTools},
      claude: {tools: [...CLAUDE_TOOLS]},
    },
  };
}
