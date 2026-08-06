import {stringifyBigint} from '../json.js';

export function coerceWorkflowValueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint' || typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString();

  const serialized = JSON.stringify(value, stringifyBigint);
  return serialized ?? '';
}
