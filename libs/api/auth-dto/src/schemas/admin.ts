import {z} from 'zod';

export const adminRoleSchema = z.enum(['admin-observer', 'admin-operator', 'admin-owner']);

export type AdminRole = z.infer<typeof adminRoleSchema>;
