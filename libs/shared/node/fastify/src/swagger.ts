import swagger, {type FastifyDynamicSwaggerOptions} from '@fastify/swagger';
import type {FastifyInstance} from 'fastify';
import {jsonSchemaTransform} from 'fastify-type-provider-zod';

export type SwaggerOptions = FastifyDynamicSwaggerOptions;

export const registerSwagger = async (app: FastifyInstance, options: SwaggerOptions) => {
  await app.register(swagger, {transform: jsonSchemaTransform, ...options});

  app.get('/openapi.json', {schema: {hide: true}}, (_request, reply) => {
    reply.send(app.swagger());
  });
};
