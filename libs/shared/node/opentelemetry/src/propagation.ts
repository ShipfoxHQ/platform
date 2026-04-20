import {type Context, context as otelContext, propagation} from '@opentelemetry/api';

export function injectContextToAttributes(
  attributes?: Record<string, string>,
  ctx?: Context,
): Record<string, string> {
  const result: Record<string, string> = {...(attributes ?? {})};
  propagation.inject(ctx ?? otelContext.active(), result);
  return result;
}

export function extractContextFromAttributes(attributes: Record<string, string>): Context {
  return propagation.extract(otelContext.active(), attributes);
}
