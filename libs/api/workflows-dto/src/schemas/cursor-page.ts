import {z} from 'zod';

export interface CursorPageDto<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

export function cursorPageSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  });
}
