import {z} from 'zod';

const RESOURCE_SLUG_MAX_LENGTH = 40;

export const RESOURCE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .min(2)
  .max(RESOURCE_SLUG_MAX_LENGTH)
  .regex(RESOURCE_SLUG_PATTERN);

export function slugifyName(name: string, options: {fallback: string}): string {
  const slug = name
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, RESOURCE_SLUG_MAX_LENGTH)
    .replaceAll(/-+$/g, '');

  return slug.length >= 2 ? slug : options.fallback;
}

export function withSlugSuffix(slug: string, attempt: number): string {
  const suffix = `-${attempt}`;
  const base = slug
    .slice(0, Math.max(0, RESOURCE_SLUG_MAX_LENGTH - suffix.length))
    .replaceAll(/-+$/g, '');

  return `${base}${suffix}`;
}
