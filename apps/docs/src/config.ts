import {createConfig, host, str} from '@shipfox/config';

export function loadConfig(update?: Partial<NodeJS.ProcessEnv>) {
  return createConfig(
    {
      VERCEL_ENV: str({
        choices: ['development', 'preview', 'production'],
        default: undefined,
        desc: 'Vercel deployment environment used to choose the canonical docs origin.',
      }),
      VERCEL_URL: host({
        default: undefined,
        desc: 'Hostname of the current Vercel deployment used for preview docs URLs.',
      }),
      NEXT_PUBLIC_VERCEL_ENV: str({
        choices: ['development', 'preview', 'production'],
        default: undefined,
        desc: 'Public Vercel deployment environment used when the server variable is unavailable.',
      }),
      NEXT_PUBLIC_VERCEL_URL: host({
        default: undefined,
        desc: 'Public hostname of the current Vercel deployment used when the server variable is unavailable.',
      }),
      NEXT_PUBLIC_BASE_PATH: str({
        default: '',
        desc: 'Path prefix applied to externally generated docs URLs, such as /docs in production.',
      }),
    },
    update,
  );
}

export const config = loadConfig();
