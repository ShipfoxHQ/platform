import {createConfig, host, str} from '@shipfox/config';

export type DocsConfig = {
  VERCEL_ENV: 'development' | 'preview' | 'production' | undefined;
  VERCEL_URL: string | undefined;
  NEXT_PUBLIC_VERCEL_ENV: 'development' | 'preview' | 'production' | undefined;
  NEXT_PUBLIC_VERCEL_URL: string | undefined;
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: string | undefined;
  NEXT_PUBLIC_BASE_PATH: string;
};

export function loadConfig(update?: Partial<NodeJS.ProcessEnv>): DocsConfig {
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
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: host({
        default: undefined,
        desc: 'Public hostname of the Vercel project production deployment used for canonical docs URLs.',
      }),
      NEXT_PUBLIC_BASE_PATH: str({
        default: '',
        desc: 'Path prefix applied to externally generated docs URLs, such as /docs in production.',
      }),
    },
    update,
  ) as unknown as DocsConfig;
}

// Next replaces this public env access with the `env` value from next.config.mjs
// at build time. Pass these values explicitly so the runtime config keeps the
// production path and canonical origin after validation.
const nextBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
const nextProjectProductionUrl = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
export const config = loadConfig(
  nextBasePath === undefined && nextProjectProductionUrl === undefined
    ? undefined
    : {
        ...(nextBasePath === undefined ? {} : {NEXT_PUBLIC_BASE_PATH: nextBasePath}),
        ...(nextProjectProductionUrl === undefined
          ? {}
          : {NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: nextProjectProductionUrl}),
      },
);
