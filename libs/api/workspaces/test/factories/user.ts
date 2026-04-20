import type {UserContext} from '@shipfox/api-auth-context';
import {Factory} from 'fishery';

export const userFactory = Factory.define<UserContext & {name: string | null}>(({sequence}) => {
  return {
    userId: crypto.randomUUID(),
    email: `user-${sequence}-${crypto.randomUUID()}@example.com`,
    name: `User ${sequence}`,
  };
});
