const CURSOR_SEPARATOR = '|';

export interface ProjectCursor {
  createdAt: Date;
  id: string;
}

export function encodeProjectCursor(cursor: ProjectCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}${CURSOR_SEPARATOR}${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeProjectCursor(cursor: string | undefined): ProjectCursor | undefined {
  if (!cursor) return undefined;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const [createdAtRaw, id] = decoded.split(CURSOR_SEPARATOR);
  if (!createdAtRaw || !id) return undefined;
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return {createdAt, id};
}
