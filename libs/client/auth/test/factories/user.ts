import {faker} from '@faker-js/faker';
import type {UserDto} from '@shipfox/api-auth-dto';
import {Factory} from 'fishery';

export const pageUserFactory = Factory.define<UserDto>(() => {
  const createdAt = faker.date.recent();

  return {
    id: faker.string.uuid(),
    email: faker.internet.email().toLowerCase(),
    name: faker.person.fullName(),
    email_verified_at: faker.helpers.maybe(() => faker.date.recent().toISOString()) ?? null,
    status: 'active',
    created_at: createdAt.toISOString(),
    updated_at: faker.date.soon({refDate: createdAt}).toISOString(),
  };
});
