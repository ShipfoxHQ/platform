import {Factory} from 'fishery';
import type {Membership} from '#core/entities/membership.js';
import {createMembership} from '#db/memberships.js';

export const membershipFactory = Factory.define<Membership>(({onCreate}) => {
  onCreate((membership) =>
    createMembership({
      userId: membership.userId,
      userEmail: membership.userEmail,
      userName: membership.userName,
      workspaceId: membership.workspaceId,
    }),
  );

  return {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    userEmail: `member-${crypto.randomUUID()}@example.com`,
    userName: null,
    workspaceId: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
