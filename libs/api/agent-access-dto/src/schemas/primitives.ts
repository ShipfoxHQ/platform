import {z} from 'zod';

export const idSchema = z.string().uuid();
export const dateTimeSchema = z.string().datetime();

const utf8Encoder = new TextEncoder();

export const utf8CappedString = (maxBytes: number) =>
  z
    .string()
    .max(maxBytes)
    .refine((value) => utf8Encoder.encode(value).byteLength <= maxBytes, {
      message: `String must contain at most ${maxBytes} UTF-8 bytes`,
    });
