export function serializedResponseByteLength(payload: string | ArrayBuffer | Buffer): number {
  return typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
}
