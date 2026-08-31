import type {Transaction} from '#db/db.js';
import {hasSessionReferencingObjectKey} from '#db/retention.js';

export async function deletableSessionObjectKeys(
  tx: Transaction,
  sessionId: string,
  headObjectKey: string | null,
  keys: string[],
): Promise<string[]> {
  if (headObjectKey === null) return keys;
  if (await hasSessionReferencingObjectKey(tx, sessionId, headObjectKey)) {
    return keys.filter((key) => key !== headObjectKey);
  }
  // Carried-over rows can point outside their own prefix.
  if (!keys.includes(headObjectKey)) return [...keys, headObjectKey];
  return keys;
}
