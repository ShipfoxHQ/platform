export function stringifyBigint(_key: string, value: unknown): unknown {
  if (typeof value !== 'bigint') return value;

  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : value.toString();
}
