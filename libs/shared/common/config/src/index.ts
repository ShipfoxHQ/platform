import {type CleanedEnv, cleanEnv} from 'envalid';

export type {
  BaseValidator,
  CleanedEnv,
  CleanedEnvAccessors,
  CleanOptions,
  ExactValidator,
  OptionalValidatorSpec,
  ReporterOptions,
  RequiredValidatorSpec,
} from 'envalid';
export {bool, cleanEnv, email, host, num, port, str, url} from 'envalid';

// Helper function to create properly typed configs
export function createConfig<T extends Record<string, unknown>>(
  schema: T,
  update?: Partial<NodeJS.ProcessEnv>,
): CleanedEnv<T> {
  return cleanEnv({...process.env, ...update}, schema);
}
