import type {RemixiconComponentType} from '@remixicon/react';
import * as RemixIcons from '@remixicon/react';

const remixiconEntries = Object.entries(RemixIcons).filter(
  ([key, value]) => key.startsWith('Ri') && typeof value === 'function',
) as Array<[string, RemixiconComponentType]>;

function iconNameToKey(iconName: string): string {
  const withoutPrefix = iconName.slice(2);
  return withoutPrefix.charAt(0).toLowerCase() + withoutPrefix.slice(1);
}

const remixiconMapEntries = remixiconEntries.map(([name, component]) => [
  iconNameToKey(name),
  component,
]) as Array<[string, RemixiconComponentType]>;

export const remixiconMap = Object.fromEntries(remixiconMapEntries) as Record<
  string,
  RemixiconComponentType
>;

export type RemixIconName = keyof typeof remixiconMap;
export const remixiconNames = Object.keys(remixiconMap) as RemixIconName[];
