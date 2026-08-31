import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  administratorUserDirectoryQuerySchema,
  administratorUserDirectoryResponseSchema,
} from './admin.js';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'alex@example.com',
  name: 'Alex Shipfox',
  status: 'active' as const,
  email_verified_at: '2026-08-31T12:00:00.000Z',
  created_at: '2026-08-01T12:00:00.000Z',
  admin_role: null,
};

const parseQuery = (query: unknown) => administratorUserDirectoryQuerySchema.safeParse(query);

const parseResponse = (users: unknown[]) =>
  administratorUserDirectoryResponseSchema.safeParse({users, next_cursor: null});

describe('administrator user directory query schema', () => {
  it('defaults the page size and accepts every optional field', () => {
    const query = administratorUserDirectoryQuerySchema.parse({
      search: ' alex ',
      status: 'suspended',
      impersonation_eligible: 'true',
      cursor: 'eyJjcmVhdGVkX2F0IjoiMjAyNi0wOC0wMSJ9',
    });

    expect(query).toEqual({
      search: 'alex',
      status: 'suspended',
      impersonation_eligible: true,
      cursor: 'eyJjcmVhdGVkX2F0IjoiMjAyNi0wOC0wMSJ9',
      limit: 50,
    });
  });

  it('accepts valid UUIDs as exact search values', () => {
    const uuid = '22222222-2222-4222-8222-222222222222';

    expect(administratorUserDirectoryQuerySchema.parse({search: uuid}).search).toBe(uuid);
    expect(administratorUserDirectoryQuerySchema.parse({search: ` ${uuid} `}).search).toBe(uuid);
  });

  it('accepts text searches from one through 128 visible code points', () => {
    expect(parseQuery({search: 'a'}).success).toBe(true);
    expect(parseQuery({search: 'a'.repeat(128)}).success).toBe(true);
    expect(parseQuery({search: 'a'.repeat(129)}).success).toBe(false);
    expect(parseQuery({search: '😀'.repeat(128)}).success).toBe(true);
  });

  it('treats an empty search as omitted', () => {
    expect(parseQuery({search: ''}).success).toBe(true);
  });

  it('rejects control and format characters in searches', () => {
    for (const search of ['alex\nshipfox', 'alex\u0000shipfox', 'alex\u200Bshipfox']) {
      expect(parseQuery({search})).toMatchObject({success: false});
    }
  });

  it('keeps wildcard characters literal and trims only outer whitespace', () => {
    const query = administratorUserDirectoryQuerySchema.parse({
      search: '  100%_\\ alex   shipfox  ',
    });

    expect(query.search).toBe('100%_\\ alex   shipfox');
  });

  it('treats a blank search as omitted', () => {
    expect(administratorUserDirectoryQuerySchema.parse({search: '   '})).toEqual({limit: 50});
  });

  it('accepts each known status and rejects unknown statuses', () => {
    for (const status of ['active', 'suspended', 'deleted']) {
      expect(parseQuery({status}).success).toBe(true);
    }

    expect(parseQuery({status: 'pending'}).success).toBe(false);
  });

  it('coerces only checked boolean query values', () => {
    expect(
      administratorUserDirectoryQuerySchema.parse({impersonation_eligible: 'true'}),
    ).toMatchObject({impersonation_eligible: true});
    expect(
      administratorUserDirectoryQuerySchema.parse({impersonation_eligible: 'false'}),
    ).toMatchObject({impersonation_eligible: false});
    expect(
      administratorUserDirectoryQuerySchema.parse({impersonation_eligible: true}),
    ).toMatchObject({impersonation_eligible: true});

    for (const value of ['1', '0', 'yes', 'TRUE', '']) {
      expect(parseQuery({impersonation_eligible: value}).success).toBe(false);
    }
  });

  it('bounds opaque encoded cursors', () => {
    expect(parseQuery({cursor: 'a'}).success).toBe(true);
    expect(parseQuery({cursor: 'a'.repeat(512)}).success).toBe(true);
    expect(parseQuery({cursor: 'a'.repeat(513)}).success).toBe(false);
    expect(parseQuery({cursor: 'not a cursor'}).success).toBe(false);
  });

  it('coerces page sizes and enforces both bounds', () => {
    expect(administratorUserDirectoryQuerySchema.parse({limit: '1'}).limit).toBe(1);
    expect(administratorUserDirectoryQuerySchema.parse({limit: '100'}).limit).toBe(100);
    expect(parseQuery({limit: '0'}).success).toBe(false);
    expect(parseQuery({limit: '101'}).success).toBe(false);
    expect(parseQuery({limit: '1.5'}).success).toBe(false);
  });

  it('rejects unknown query fields', () => {
    expect(parseQuery({unexpected: 'value'}).success).toBe(false);
  });
});

describe('administrator user directory response schema', () => {
  it('accepts an empty response with no next page', () => {
    expect(parseResponse([])).toMatchObject({success: true});
  });

  it('accepts a complete user summary and a nullable next cursor', () => {
    const result = administratorUserDirectoryResponseSchema.parse({
      users: [{...user, admin_role: 'admin-owner'}],
      next_cursor: 'eyJjdXJzb3IiOiJuZXh0In0',
    });

    expect(result).toEqual({
      users: [{...user, admin_role: 'admin-owner'}],
      next_cursor: 'eyJjdXJzb3IiOiJuZXh0In0',
    });
  });

  it('accepts 100 users and rejects a 101st user', () => {
    expect(parseResponse(Array.from({length: 100}, () => user)).success).toBe(true);
    expect(parseResponse(Array.from({length: 101}, () => user)).success).toBe(false);
  });
});
