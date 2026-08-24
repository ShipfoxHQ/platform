import {
  type DefinitionAtRefFileDto,
  type DefinitionAtRefResponseDto,
  definitionAtRefResponseSchema,
} from '@shipfox/api-definitions-dto';
import {ApiError, checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
import type {DefinitionAtRefFile, DefinitionAtRefListing} from '#core/definitions-at-ref.js';

export const definitionsAtRefQueryKeys = {
  all: ['definitions-at-ref'] as const,
  atRef: (projectId: string, ref: string) =>
    [...definitionsAtRefQueryKeys.all, projectId, ref] as const,
};

type DefinitionsAtRefQueryKey =
  | ReturnType<typeof definitionsAtRefQueryKeys.atRef>
  | readonly ['definitions-at-ref'];

type DefinitionsAtRefQueryOptions = UseQueryOptions<
  DefinitionAtRefListing,
  Error,
  DefinitionAtRefListing,
  DefinitionsAtRefQueryKey
>;

export interface DefinitionsAtRefErrorCopy {
  title: string;
  message: string;
}

/**
 * List the workflow definition files at a git ref with their validation state
 * and the pinned commit. The listing is fetched on demand by the run-from-branch
 * picker; nothing is persisted per ref.
 */
export async function listDefinitionsAtRef({
  projectId,
  ref,
  signal,
}: {
  projectId: string;
  ref: string;
  signal?: AbortSignal;
}): Promise<DefinitionAtRefListing> {
  const params = new URLSearchParams({project_id: projectId, ref});
  const response = await checkedApiRequest(
    definitionAtRefResponseSchema,
    `/definitions/at-ref?${params.toString()}`,
    {signal},
  );
  return toDefinitionAtRefListing(response);
}

function toDefinitionAtRefListing(response: DefinitionAtRefResponseDto): DefinitionAtRefListing {
  return {
    ref: response.ref,
    commit: response.commit,
    files: response.files.map(toDefinitionAtRefFile),
  };
}

function toDefinitionAtRefFile(file: DefinitionAtRefFileDto): DefinitionAtRefFile {
  return {
    configPath: file.config_path,
    name: file.name,
    valid: file.valid,
    errors: file.errors,
    warnings: file.warnings,
    triggers: file.triggers,
  };
}

export function definitionsAtRefQueryOptions(
  projectId: string | undefined,
  ref: string | undefined,
): DefinitionsAtRefQueryOptions {
  return queryOptions({
    queryKey:
      projectId && ref
        ? definitionsAtRefQueryKeys.atRef(projectId, ref)
        : ([...definitionsAtRefQueryKeys.all] as const),
    enabled: Boolean(projectId && ref),
    queryFn: ({signal}) =>
      listDefinitionsAtRef({projectId: projectId ?? '', ref: ref ?? '', signal}),
  });
}

export function useDefinitionsAtRefQuery(projectId: string | undefined, ref: string | undefined) {
  return useQuery(definitionsAtRefQueryOptions(projectId, ref));
}

/**
 * User-facing copy for a failed `GET /definitions/at-ref` request. The dialog
 * shows `ref-invalid` and `ref-not-found` inline on the ref input and every
 * other failure as a form-level alert.
 */
export function definitionsAtRefErrorCopy(error: unknown): DefinitionsAtRefErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Something went wrong',
      message: 'Try again in a moment.',
    };
  }

  switch (error.code) {
    case 'network-error':
      return {
        title: 'Network problem',
        message: 'We could not reach the API. Check your connection and try again.',
      };
    case 'ref-invalid':
      return {
        title: 'Ref is not a branch or tag',
        message: 'Enter a branch or tag name in this repository.',
      };
    case 'ref-not-found':
      return {
        title: 'Ref not found',
        message: 'This branch or tag does not exist in the repository.',
      };
    case 'project-not-found':
      return {
        title: 'Project not found',
        message: 'This project does not exist, or you no longer have access to it.',
      };
    case 'too-many-files':
      return {
        title: 'Too many workflow files',
        message:
          'This ref has more workflow files than Shipfox can list. Narrow the ref and try again.',
      };
    case 'integration-connection-inactive':
      return {
        title: 'Source connection inactive',
        message: 'Reconnect or choose another source-control connection.',
      };
    case 'integration-connection-not-found':
      return {
        title: 'Source connection not found',
        message: 'Reconnect source control and try again.',
      };
    case 'forbidden':
      return {
        title: 'Access changed',
        message: 'You no longer have access to this workspace or project.',
      };
    case 'rate-limited':
      return {
        title: 'Provider rate limited',
        message: 'The provider is asking us to slow down. Try again shortly.',
      };
    case 'source-unavailable':
      return {
        title: 'Source repository unavailable',
        message: 'Shipfox could not read the repository right now. Try again in a moment.',
      };
    default:
      return {
        title: 'Could not list workflow files',
        message: error.message || 'Try again in a moment.',
      };
  }
}
