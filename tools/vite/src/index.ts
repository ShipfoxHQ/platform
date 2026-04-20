import {
  type ConfigEnv,
  type UserConfig,
  type UserConfigExport,
  type UserConfigFnObject,
  defineConfig as viteDefinedConfig,
} from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export type {ConfigEnv, UserConfig, UserConfigExport, UserConfigFnObject} from 'vite';
export {loadEnv} from 'vite';

export function defineConfig(configOrFn?: UserConfig | UserConfigFnObject): UserConfigExport {
  const mergeConfig = (config?: UserConfig) => ({
    ...config,
    plugins: [tsconfigPaths(), ...(config?.plugins || [])],
  });
  const config =
    typeof configOrFn === 'function'
      ? (env: ConfigEnv) => mergeConfig(configOrFn(env))
      : mergeConfig(configOrFn ?? {});
  return viteDefinedConfig(config);
}
