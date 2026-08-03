import {useParams, useSearch} from '@tanstack/react-router';
import {useMemo} from 'react';

/**
 * Reads inputs at the dynamic feature-route boundary. Feature routes must immediately
 * validate the result and pass typed values to pages; Shell never interprets feature input.
 */
export function useRouteSearch<T>(parse: (search: Record<string, unknown>) => T): T {
  const search = useSearch({strict: false}) as Record<string, unknown>;
  return useMemo(() => parse(search), [parse, search]);
}

/**
 * Reads path parameters at the dynamic feature-route boundary without making Shell
 * responsible for a feature's parameter contract.
 */
export function useRouteParams<T>(parse: (params: Record<string, unknown>) => T): T {
  const params = useParams({strict: false}) as Record<string, unknown>;
  return useMemo(() => parse(params), [parse, params]);
}

function optionalRouteString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseWorkspaceParams(input: Record<string, unknown>): {workspaceSlug?: string} {
  const workspaceSlug = optionalRouteString(input.workspaceSlug);
  return workspaceSlug ? {workspaceSlug} : {};
}

export function parseWorkspaceProjectParams(input: Record<string, unknown>): {
  workspaceSlug?: string;
  projectSlug?: string;
} {
  const workspaceSlug = optionalRouteString(input.workspaceSlug);
  const projectSlug = optionalRouteString(input.projectSlug);
  return {
    ...(workspaceSlug ? {workspaceSlug} : {}),
    ...(projectSlug ? {projectSlug} : {}),
  };
}
