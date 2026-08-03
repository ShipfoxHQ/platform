import type {Buffer} from 'node:buffer';
import type {FastifyInstance, FastifyPluginAsync} from 'fastify';
import fp from 'fastify-plugin';

export interface RawBodyPluginOptions {
  /** Content type to parse as a raw Buffer (e.g. application/json, application/x-ndjson). */
  contentType: string;
  /** Largest body accepted for this content type, in bytes. */
  bodyLimit?: number;
}

/**
 * Builds a scoped plugin that delivers one content type as the exact request
 * bytes (a Buffer) instead of a parsed object. Used where byte fidelity matters:
 * webhook signature verification (exact JSON bytes) and log ingest (NDJSON whose
 * offsets and payload byte counts must match the bytes the runner sent).
 *
 * It removes the inherited content-type parsers within its scope, so register it
 * on a route group dedicated to the raw content type. Do not register it on a
 * group that also serves JSON-parsed routes.
 */
export function createRawBodyPlugin({
  contentType,
  bodyLimit,
}: RawBodyPluginOptions): FastifyPluginAsync {
  const pluginFn: FastifyPluginAsync = (scope: FastifyInstance) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      contentType,
      {parseAs: 'buffer', ...(bodyLimit !== undefined ? {bodyLimit} : {})},
      (_request, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
        done(null, body);
      },
    );
    return Promise.resolve();
  };
  return fp(pluginFn);
}

/**
 * Webhook signatures are computed over exact bytes; JSON parsing can change key
 * order or unicode escaping before verification.
 */
export const rawBodyPlugin = createRawBodyPlugin({contentType: 'application/json'});

/**
 * Body-size cap shared by webhook receivers. Provider payloads (e.g. GitHub
 * push events) can be large, so this is intentionally generous.
 */
export const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;
