import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {Factory} from 'fishery';
import type {RunnerToken} from '#core/entities/runner-token.js';
import {createRunnerToken} from '#db/runner-tokens.js';

export interface RunnerTokenFactoryTransientParams {
  rawToken?: string;
}

export const runnerTokenFactory = Factory.define<RunnerToken, RunnerTokenFactoryTransientParams>(
  ({onCreate, transientParams}) => {
    const rawToken = transientParams.rawToken ?? generateOpaqueToken('runnerToken');

    onCreate((token) => {
      return createRunnerToken({
        workspaceId: token.workspaceId,
        hashedToken: token.hashedToken,
        prefix: token.prefix,
        name: token.name ?? undefined,
        expiresAt: token.expiresAt ?? undefined,
      });
    });

    return {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      hashedToken: hashOpaqueToken(rawToken),
      prefix: extractDisplayPrefix(rawToken),
      name: 'test runner',
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
