import {hash, verify} from '@node-rs/argon2';

export interface HashPasswordParams {
  password: string;
}

export interface VerifyPasswordParams {
  password: string;
  hash: string;
}

// Algorithm.Argon2id = 2; using literal here to avoid const-enum import under verbatimModuleSyntax.
const HASH_OPTIONS = {algorithm: 2} as const;

export function hashPassword(params: HashPasswordParams): Promise<string> {
  return hash(params.password, HASH_OPTIONS);
}

export function verifyPassword(params: VerifyPasswordParams): Promise<boolean> {
  return verify(params.hash, params.password);
}
