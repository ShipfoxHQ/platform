import {captureException} from '@shipfox/node-error-monitoring';
import type {FastifyReply, FastifyRequest} from 'fastify';
import {ClientError} from './clientError.js';

const fastifyErrorMap: Record<string, {status: number; code: string}> = {
  FST_ERR_CTP_BODY_TOO_LARGE: {status: 413, code: 'body-too-large'},
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {status: 415, code: 'invalid-media-type'},
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: {status: 400, code: 'invalid-content-length'},
  FST_ERR_CTP_EMPTY_JSON_BODY: {status: 400, code: 'empty-json-body'},
  FST_ERR_CTP_INVALID_JSON_BODY: {status: 400, code: 'invalid-json-body'},
  FST_ERR_NOT_FOUND: {status: 404, code: 'not-found'},
  FST_ERR_HANDLER_TIMEOUT: {status: 408, code: 'handler-timeout'},
};

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ClientError) {
    request.log.info(error, error.message);
    const payload =
      error.details === undefined ? {code: error.code} : {code: error.code, details: error.details};
    return reply.code(error.status || 400).send(payload);
  }

  if (
    error instanceof Error &&
    'validationContext' in error &&
    'validation' in error &&
    'code' in error &&
    error.code === 'FST_ERR_VALIDATION'
  ) {
    request.log.info(error, error.message);
    const validation = error.validation as Array<{message: string}>;
    return reply.code(400).send({
      code: 'validation-error',
      message: `[${error.validationContext}] ${validation[0]?.message}`,
    });
  }

  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    const mapped = fastifyErrorMap[error.code];
    if (mapped) {
      request.log.info(error, error.message);
      return reply.code(mapped.status).send({code: mapped.code});
    }
  }

  request.log.error(error);
  captureException(error);
  return reply.code(500).send({code: 'server-error'});
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({code: 'not-found'});
}
