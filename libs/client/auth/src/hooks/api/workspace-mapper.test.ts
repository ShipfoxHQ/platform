import type {WorkspaceResponseDto} from '@shipfox/api-workspaces-dto';
import {toWorkspace} from './workspace-mapper.js';

describe('toWorkspace', () => {
  test.each([
    'active',
    'suspended',
    'deleted',
  ] as const)('maps a %s workspace to its domain shape', (status) => {
    const dto: WorkspaceResponseDto = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Acme',
      slug: 'acme',
      status,
      settings: {},
      created_at: '2026-04-27T00:00:00.000Z',
      updated_at: '2026-04-27T00:00:00.000Z',
    };

    expect(toWorkspace(dto)).toEqual({id: dto.id, name: dto.name, slug: dto.slug, status});
  });
});
