import type {VcsProviderKind} from '../entities/vcs-connection.js';
import {VcsProviderError} from '../errors.js';
import {TestVcsProvider} from './test-provider.js';
import type {VcsProvider} from './vcs-provider.js';

export interface VcsProviderRegistry {
  get(provider: VcsProviderKind): VcsProvider;
}

class MapVcsProviderRegistry implements VcsProviderRegistry {
  constructor(private readonly providers: Map<VcsProviderKind, VcsProvider>) {}

  get(provider: VcsProviderKind): VcsProvider {
    const resolved = this.providers.get(provider);
    if (!resolved) {
      throw new VcsProviderError(
        'provider-unavailable',
        `No VCS provider registered for ${provider}`,
      );
    }
    return resolved;
  }
}

let registry: VcsProviderRegistry = new MapVcsProviderRegistry(
  new Map([['test', new TestVcsProvider()]]),
);

export function vcsProviderRegistry(): VcsProviderRegistry {
  return registry;
}

export function setVcsProviderRegistry(next: VcsProviderRegistry): void {
  registry = next;
}

export function resetVcsProviderRegistry(): void {
  registry = new MapVcsProviderRegistry(new Map([['test', new TestVcsProvider()]]));
}
